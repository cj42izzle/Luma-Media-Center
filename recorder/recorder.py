"""Luma IPTV recorder: owner-authenticated XMLTV scheduler backed by FFmpeg."""
import gzip
import hashlib
import hmac
import ipaddress
import json
import os
import re
import shutil
import socket
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DATA = Path(os.getenv("LUMA_DATA_DIR", "/data"))
MEDIA = Path(os.getenv("LUMA_RECORDINGS_DIR", "/recordings"))
TOKEN = os.getenv("LUMA_RECORDER_TOKEN", "")
ORIGINS = [x.strip() for x in os.getenv("LUMA_ALLOWED_ORIGINS", "https://cj42izzle.github.io").split(",") if x.strip()]
ALLOW_PRIVATE = os.getenv("LUMA_ALLOW_PRIVATE_SOURCES", "false").lower() == "true"
STATE_PATH = DATA / "state.json"
LOCK = threading.RLock()
STATE = {"source": {}, "jobs": [], "rules": [], "recorded": []}
CHANNELS = []
PROGRAMS = []
WORKERS = {}
NEXT_REFRESH = 0

def save_state():
    DATA.mkdir(parents=True, exist_ok=True)
    temp = STATE_PATH.with_suffix(".tmp")
    temp.write_text(json.dumps(STATE, separators=(",", ":")), encoding="utf-8")
    os.replace(temp, STATE_PATH)

def load_state():
    if STATE_PATH.is_file():
        try:
            parsed = json.loads(STATE_PATH.read_text(encoding="utf-8"))
            if isinstance(parsed, dict):
                for key in STATE:
                    if isinstance(parsed.get(key), type(STATE[key])):
                        STATE[key] = parsed[key]
        except (ValueError, OSError):
            pass
    # Jobs may outlive the previous process, but their FFmpeg worker does not.
    for job in STATE["jobs"]:
        if job["status"] == "recording":
            job["status"] = "scheduled" if job["end"] > int(time.time() * 1000) else "interrupted"

def url_allowed(url):
    try:
        u = urllib.parse.urlsplit(url)
        if u.scheme not in ("https", "http") or not u.hostname or u.username or u.password:
            return False
        if u.port not in (None, 80, 443, 8080, 8000, 8888):
            return False
        addrs = socket.getaddrinfo(u.hostname, None)
        for addr in addrs:
            ip = ipaddress.ip_address(addr[4][0])
            if not ALLOW_PRIVATE and not ip.is_global:
                return False
        return True
    except (ValueError, OSError):
        return False

class CheckedRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        if not url_allowed(newurl):
            raise ValueError("Blocked unsafe playlist redirect")
        return super().redirect_request(request, fp, code, msg, headers, newurl)

def fetch_feed(url, limit):
    if not url_allowed(url):
        raise ValueError("Invalid or private feed address; HTTPS is recommended")
    request = urllib.request.Request(url, headers={"User-Agent": "LumaGuide/1.0", "Accept-Encoding": "gzip"})
    opener = urllib.request.build_opener(CheckedRedirect())
    with opener.open(request, timeout=22) as response:
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError("Feed exceeds size limit")
        if response.headers.get("Content-Encoding") == "gzip" or url.lower().endswith(".gz"):
            data = gzip.decompress(data)
            if len(data) > limit:
                raise ValueError("Uncompressed guide exceeds size limit")
        return data.decode("utf-8-sig", "replace")

def attr(line, name):
    found = re.search(r'\b' + re.escape(name) + r'\s*=\s*"([^"]{0,300})"', line, re.I)
    return found.group(1).strip() if found else ""

def parse_m3u(text):
    if not text.lstrip().startswith("#EXTM3U"):
        raise ValueError("Expected a media playlist beginning #EXTM3U")
    entries = []
    pending = None
    for line in text.splitlines()[:75000]:
        line = line.strip()
        if line.startswith("#EXTINF:"):
            name = line.split(",", 1)[1].strip() if "," in line else "Unknown channel"
            pending = {"name": name[:120], "epg_id": attr(line, "tvg-id"), "group": attr(line, "group-title")[:80],
                       "logo": attr(line, "tvg-logo")[:400], "quality": 2 if "4K" in name.upper() else 1 if re.search(r"\b(FHD|HD|1080P)\b", name, re.I) else 0}
        elif pending and line and not line.startswith("#"):
            if urllib.parse.urlsplit(line).scheme in ("http", "https"):
                key = hashlib.sha256((pending["epg_id"] + "|" + pending["name"] + "|" + line).encode()).hexdigest()[:18]
                entries.append({"id": key, "url": line[:3500], **pending})
                if len(entries) >= 4000:
                    break
            pending = None
    return entries

def xml_time(value):
    m = re.match(r"^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?(?:\s*([+-])(\d\d)(\d\d))?", value or "")
    if not m:
        return 0
    try:
        year, month, day, hour, minute = map(int, m.group(1, 2, 3, 4, 5))
        second = int(m.group(6) or "0")
        offset = (int(m.group(8) or 0) * 60 + int(m.group(9) or 0)) * (1 if m.group(7) != "-" else -1)
        return int(datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc).timestamp() * 1000 - offset * 60000)
    except ValueError:
        return 0

def ep_number(program):
    for elem in program.findall("episode-num"):
        value = (elem.text or "").strip()
        system = elem.get("system", "")
        if system == "xmltv_ns":
            m = re.match(r"^(\d+)(?:/\d+)?\s*\.\s*(\d+)(?:/\d+)?", value)
            if m:
                return "S%02dE%02d" % (int(m.group(1)) + 1, int(m.group(2)) + 1)
        if system == "onscreen" and re.search(r"S\d{1,3}E\d{1,3}", value, re.I):
            return re.search(r"S\d{1,3}E\d{1,3}", value, re.I).group(0).upper()
        if system == "dd_progid" and value.startswith("EP"):
            return value[:80]
    return ""

def parse_xmltv(text, channels):
    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        raise ValueError("XML entity declarations are not accepted")
    root = ET.fromstring(text)
    if root.tag != "tv":
        raise ValueError("Expected an XMLTV tv guide")
    labels = {}
    for ch in root.findall("channel"):
        label = ch.findtext("display-name", default="").strip().lower()
        if ch.get("id") and label:
            labels[ch.get("id")] = label
    by_id = {}
    for ch in channels:
        if ch["epg_id"]:
            by_id.setdefault(ch["epg_id"], []).append(ch)
    by_name = {}
    for ch in channels:
        by_name.setdefault(ch["name"].strip().lower(), []).append(ch)
    programs, dedup = [], set()
    now = int(time.time() * 1000)
    for e in root.findall("programme")[:30000]:
        guide_id = e.get("channel", "")
        choices = by_id.get(guide_id, [])
        if not choices and guide_id in labels:
            choices = by_name.get(labels[guide_id], [])
        if not choices:
            continue
        # The matching programme is only assigned to channels explicitly matched to its guide identity.
        channel = sorted(choices, key=lambda c: c["quality"], reverse=True)[0]
        start, stop = xml_time(e.get("start")), xml_time(e.get("stop"))
        if stop <= start or stop < now - 3600000 or start > now + 14 * 86400000:
            continue
        title = (e.findtext("title") or "").strip()[:160]
        if not title:
            continue
        subtitle = (e.findtext("sub-title") or "").strip()[:100]
        episode = ep_number(e)
        hashkey = hashlib.sha256((channel["id"] + "|" + str(start) + "|" + str(stop) + "|" + title).encode()).hexdigest()[:20]
        if hashkey in dedup:
            continue
        dedup.add(hashkey)
        programs.append({"id": hashkey, "channel_id": channel["id"], "channel": channel["name"],
                         "title": title, "subtitle": subtitle, "description": (e.findtext("desc") or "")[:400],
                         "start": start, "end": stop, "episode": episode,
                         "is_new": e.find("new") is not None or e.find("premiere") is not None,
                         "rerun": e.find("previously-shown") is not None})
    return sorted(programs, key=lambda p: (p["start"], p["channel"]))


def normalized_text(value):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", str(value or "").casefold())).strip()

def episode_identity(program):
    """Strong episode number, otherwise stable subtitle/description matching.

    An identical description may be reused across multiple episodes by a provider.
    Such feeds cannot guarantee deduplication, so a descriptive fingerprint is a
    best-effort identity, not proof of a premiere or the episode's air date.
    """
    episode = normalized_text(program.get("episode"))
    if len(episode) >= 4:
        return "number:" + episode
    subtitle = normalized_text(program.get("subtitle"))
    description = normalized_text(program.get("description"))
    if len(subtitle) >= 8:
        material = "subtitle:" + subtitle
    elif len(description) >= 36 and description not in ("no description available", "information not available"):
        material = "description:" + description
    else:
        return ""
    return "metadata:" + hashlib.sha256(material.encode()).hexdigest()[:20]

def series_record_id(rule, program):
    ident = episode_identity(program)
    if not ident:
        return ""
    # Track across overlapping rules for the same channel+series.
    series = normalized_text(program["channel_id"] + "|" + program["title"])
    return "series:" + hashlib.sha256((series + "|" + ident).encode()).hexdigest()[:32]

def match_series(rule, program):
    if rule["channel_id"] != program["channel_id"] or rule["title"].casefold() != program["title"].casefold():
        return False
    if rule["mode"] == "new":
        return program["is_new"] and not program["rerun"]
    if rule["mode"] == "unseen":
        # Includes reruns if this distinct episode has never been recorded.
        return bool(episode_identity(program))
    return True

def create_job(program, rule=None, pre=0, post=0):
    episode_id = series_record_id(rule, program) if rule and rule["mode"] != "all" else ""
    if rule and rule["mode"] == "unseen" and not episode_id:
        return None
    if episode_id and (episode_id in STATE["recorded"] or any(j.get("episode_id") == episode_id and j["status"] not in ("cancelled", "failed") for j in STATE["jobs"])):
        return None
    if any(j["program_id"] == program["id"] and j["status"] not in ("cancelled", "failed") for j in STATE["jobs"]):
        return None
    if program["end"] <= int(time.time() * 1000):
        return None
    job = {"id": uuid.uuid4().hex[:16], "program_id": program["id"], "channel_id": program["channel_id"],
           "title": program["title"], "episode": program["episode"], "episode_id": episode_id,
           "start": program["start"] - int(pre) * 60000, "end": program["end"] + int(post) * 60000,
           "status": "scheduled", "file": "", "error": "", "rule_id": rule["id"] if rule else ""}
    STATE["jobs"].append(job)
    return job

def apply_series_rules():
    changed = False
    for rule in STATE["rules"]:
        if not rule.get("enabled", True):
            continue
        for program in PROGRAMS:
            if match_series(rule, program) and create_job(program, rule=rule):
                changed = True
    if changed:
        save_state()

def refresh_guide():
    global CHANNELS, PROGRAMS, NEXT_REFRESH
    with LOCK:
        source = STATE["source"].copy()
    if not source.get("m3u_url"):
        return
    raw_m3u = fetch_feed(source["m3u_url"], 4 * 1024 * 1024)
    channels = parse_m3u(raw_m3u)
    programs = parse_xmltv(fetch_feed(source["xmltv_url"], 24 * 1024 * 1024), channels) if source.get("xmltv_url") else []
    with LOCK:
        CHANNELS, PROGRAMS = channels, programs
        NEXT_REFRESH = time.time() + 30 * 60
        apply_series_rules()

def record_worker(job, channel):
    now = int(time.time() * 1000)
    duration = max(1, int((job["end"] - now) / 1000))
    stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", job["title"]).strip("_")[:70] or "recording"
    filename = stem + "_" + str(job["start"]) + "_" + job["id"] + ".ts"
    dest = MEDIA / filename
    command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
               "-i", channel["url"], "-t", str(duration), "-map", "0", "-c", "copy", "-f", "mpegts", str(dest)]
    try:
        code = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=duration + 90, check=False).returncode
        with LOCK:
            job["status"] = "complete" if code == 0 and dest.is_file() and dest.stat().st_size > 0 else "failed"
            job["file"] = filename if job["status"] == "complete" else ""
            job["error"] = "" if job["status"] == "complete" else "Recorder could not copy this stream"
            if job["status"] == "complete" and job["episode_id"] and job["episode_id"] not in STATE["recorded"]:
                STATE["recorded"].append(job["episode_id"])
            save_state()
    except (OSError, subprocess.TimeoutExpired):
        with LOCK:
            job["status"], job["error"] = "failed", "Recorder failed or timed out"
            save_state()
    finally:
        WORKERS.pop(job["id"], None)

def scheduler():
    while True:
        try:
            if STATE["source"].get("m3u_url") and time.time() >= NEXT_REFRESH:
                try:
                    refresh_guide()
                except (ValueError, OSError):
                    pass
            with LOCK:
                now = int(time.time() * 1000)
                for job in STATE["jobs"]:
                    if job["status"] == "scheduled" and job["end"] <= now:
                        job["status"], job["error"] = "missed", "Program ended before recording began"
                    if job["status"] != "scheduled" or job["start"] > now or job["end"] <= now or len(WORKERS) >= 3:
                        continue
                    channel = next((c for c in CHANNELS if c["id"] == job["channel_id"]), None)
                    if not channel:
                        continue
                    job["status"] = "recording"
                    thread = threading.Thread(target=record_worker, args=(job, channel), daemon=True)
                    WORKERS[job["id"]] = thread
                    thread.start()
                save_state()
        except Exception:
            pass
        time.sleep(8)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Never log playlist URLs, stream tokens or Authorization headers.
    def cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
    def send_json(self, data, code=200):
        payload = json.dumps(data, separators=(",", ":")).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)
    def auth(self):
        candidate = self.headers.get("Authorization", "")
        if not TOKEN or not hmac.compare_digest(candidate, "Bearer " + TOKEN):
            self.send_json({"error": "Unauthorized"}, 401)
            return False
        return True
    def payload(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 32768:
            raise ValueError("Invalid JSON size")
        data = json.loads(self.rfile.read(length))
        if not isinstance(data, dict):
            raise ValueError("Expected object")
        return data
    def do_OPTIONS(self):
        self.send_response(204);self.cors();self.end_headers()
    def do_GET(self):
        if not self.auth(): return
        path = urllib.parse.urlsplit(self.path).path
        with LOCK:
            if path == "/health":
                return self.send_json({"ok": True, "ffmpeg": bool(shutil.which("ffmpeg")), "channels": len(CHANNELS), "programs": len(PROGRAMS), "recorder": "Luma"})
            if path == "/guide":
                return self.send_json({"channels": CHANNELS, "programs": PROGRAMS, "guide_updated": int((NEXT_REFRESH - 1800) * 1000) if NEXT_REFRESH else 0})
            if path == "/recordings":
                return self.send_json({"jobs": STATE["jobs"][-500:], "rules": STATE["rules"]})
            if path.startswith("/recordings/") and path.endswith("/file"):
                id = path.split("/")[2]
                job = next((j for j in STATE["jobs"] if j["id"] == id and j["status"] == "complete"), None)
                if not job or "/" in job["file"] or "\\" in job["file"]:return self.send_json({"error":"Not found"},404)
                file = MEDIA / job["file"]
                if not file.is_file():return self.send_json({"error":"Recording is missing"},404)
                self.send_response(200);self.cors()
                self.send_header("Content-Type","video/mp2t")
                self.send_header("Content-Disposition",'attachment; filename="' + job["file"] + '"')
                self.send_header("Content-Length",str(file.stat().st_size));self.end_headers()
                with file.open("rb") as stream:
                    shutil.copyfileobj(stream,self.wfile, 1024*256)
                return
        return self.send_json({"error":"Not found"},404)
    def do_POST(self):
        if not self.auth():return
        try:
            data = self.payload()
            path = urllib.parse.urlsplit(self.path).path
            if path == "/sources":
                playlist = str(data.get("m3u_url") or "").strip()[:3500]
                epg = str(data.get("xmltv_url") or "").strip()[:3500]
                if not playlist or not url_allowed(playlist) or epg and not url_allowed(epg):
                    raise ValueError("Invalid M3U or XMLTV URL")
                with LOCK:
                    old = STATE["source"]
                    STATE["source"] = {"m3u_url":playlist, "xmltv_url":epg}
                try:refresh_guide()
                except Exception:
                    with LOCK:STATE["source"]=old
                    raise ValueError("Could not load a valid IPTV playlist and guide; prior source preserved")
                with LOCK:save_state()
                return self.send_json({"ok":True,"channels":len(CHANNELS),"programs":len(PROGRAMS)})
            if path == "/refresh":
                refresh_guide()
                return self.send_json({"ok":True,"programs":len(PROGRAMS)})
            if path == "/recordings":
                with LOCK:
                    program = next((p for p in PROGRAMS if p["id"] == data.get("program_id")),None)
                    if not program:raise ValueError("Program is not in the current guide")
                    job = create_job(program,pre=max(0,min(15,int(data.get("pre",0)))),post=max(0,min(30,int(data.get("post",0)))))
                    if not job:raise ValueError("Recording is already scheduled or program has ended")
                    save_state()
                    return self.send_json({"job":job},201)
            if path == "/rules":
                mode = data.get("mode")
                title = str(data.get("title") or "").strip()[:160]
                cid = str(data.get("channel_id") or "")
                if mode not in ("new","unseen","all") or not title or not any(c["id"]==cid for c in CHANNELS):raise ValueError("Invalid series recording rule")
                with LOCK:
                    rule={"id":uuid.uuid4().hex[:12],"title":title,"channel_id":cid,"mode":mode,"enabled":True}
                    STATE["rules"].append(rule)
                    apply_series_rules();save_state()
                    return self.send_json({"rule":rule},201)
            return self.send_json({"error":"Not found"},404)
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as err:
            return self.send_json({"error":str(err)[:170]},400)
    def do_DELETE(self):
        if not self.auth():return
        path = urllib.parse.urlsplit(self.path).path
        with LOCK:
            if path.startswith("/rules/"):
                rid=path.split("/")[2]
                count=len(STATE["rules"])
                STATE["rules"]=[r for r in STATE["rules"] if r["id"]!=rid]
                save_state()
                return self.send_json({"deleted":count>len(STATE["rules"])})
            if path.startswith("/recordings/"):
                job=next((j for j in STATE["jobs"] if j["id"]==path.split("/")[2]),None)
                if not job:return self.send_json({"error":"Not found"},404)
                if job["status"]!="scheduled":raise ValueError("Only pending recordings can be cancelled")
                job["status"]="cancelled";save_state()
                return self.send_json({"cancelled":True})
        return self.send_json({"error":"Not found"},404)

if __name__ == "__main__":
    if len(TOKEN) < 24:
        raise SystemExit("Set LUMA_RECORDER_TOKEN to at least 24 unpredictable characters")
    DATA.mkdir(parents=True,exist_ok=True)
    MEDIA.mkdir(parents=True,exist_ok=True)
    if not shutil.which("ffmpeg"):
        raise SystemExit("FFmpeg is required")
    load_state()
    threading.Thread(target=scheduler,daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0",int(os.getenv("PORT","8787"))),Handler).serve_forever()
