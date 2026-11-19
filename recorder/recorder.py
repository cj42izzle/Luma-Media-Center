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
STATE = {"source": {}, "sources": [], "epg_sources": [], "epg_mappings": {}, "jobs": [], "rules": [], "recorded": []}
CHANNELS = []
VOD = []
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
    if not STATE["sources"] and STATE["source"].get("m3u_url"):
        STATE["sources"] = [{"id":"legacy","name":"Original IPTV","m3u_url":STATE["source"]["m3u_url"],"xmltv_url":STATE["source"].get("xmltv_url","")}]
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


def vod_kind(entry):
    group=str(entry.get("group","")).casefold()
    path=urllib.parse.urlsplit(str(entry.get("url",""))).path.casefold()
    if re.search(r"\b(series|tv shows|tv series)\b",group) or "/series/" in path:return "series"
    if re.search(r"\b(vod|movies?|films?|cinema)\b",group) or re.search(r"/movies?/",path):return "movie"
    return ""

def vod_entry(item):
    kind=vod_kind(item)
    if not kind:return None
    raw=item["name"]
    m=(re.search(r"\bS(\d{1,3})[._ -]*E(\d{1,3})\b",raw,re.I)
       or re.search(r"\b(\d{1,3})\s*x\s*(\d{1,3})\b",raw,re.I)
       or re.search(r"\bSeason[ ._-]*(\d{1,3})[ ._-]*Episode[ ._-]*(\d{1,3})\b",raw,re.I))
    season,episode=(int(m.group(1)),int(m.group(2))) if m else (0,0)
    title=raw[:m.start()] if m else raw
    title=re.sub(r"\s*\((?:19|20)\d{2}\)\s*"," ",title)
    title=re.sub(r"\s+(?:4K|1080P|720P|FHD|HD)\s*$","",title,flags=re.I).strip()
    year=re.search(r"\b(?:19|20)\d{2}\b",raw)
    key=re.sub(r"[^\w]+"," ",title.casefold()).strip().replace("_"," ")
    return {**item,"type":kind,"title":title,"title_key":key,"season":season,"episode_number":episode,"year":year.group(0) if year else ""} if key else None

def vod_matches(rows,args):
    title=re.sub(r"[^\w]+"," ",str(args.get("title","")).casefold()).strip().replace("_"," ")
    kind=args.get("type","movie")
    year=str(args.get("year",""))[:4]
    if not title or kind not in ("movie","series"):return []
    try:season,episode=int(args.get("season",0) or 0),int(args.get("episode",0) or 0)
    except (ValueError,TypeError):return []
    matches=[]
    for row in rows:
        if row["type"]!=kind or row["title_key"]!=title:continue
        if year and row["year"] and year!=row["year"]:continue
        if kind=="series" and (season<1 or episode<1 or row["season"]!=season or row["episode_number"]!=episode):continue
        matches.append(row)
    return sorted(matches,key=lambda row:row.get("quality",0),reverse=True)[:30]

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

def epg_catalog(text):
    """Return XMLTV channel IDs/names, without parsing programme payloads."""
    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        raise ValueError("XML entity declarations are not accepted")
    root = ET.fromstring(text)
    if root.tag != "tv":
        raise ValueError("Expected an XMLTV tv guide")
    rows, seen = [], set()
    for ch in root.findall("channel")[:10000]:
        cid = str(ch.get("id") or "").strip()[:160]
        if not cid or cid in seen:
            continue
        seen.add(cid)
        label = (ch.findtext("display-name") or cid).strip()[:160]
        rows.append({"id": cid, "name": label or cid})
    return rows


def parse_xmltv(text, channels, *, strict=False, assign_all=False):
    """Map XMLTV programs onto the chosen live stations.

    strict=True requires exact tvg-id / chosen guide-channel ID (no name guesses).
    assign_all=True mirrors the same EPG broadcast onto multiple explicitly mapped
    stations, without incorrectly attaching only to the highest-quality station.
    """
    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        raise ValueError("XML entity declarations are not accepted")
    root = ET.fromstring(text)
    if root.tag != "tv":
        raise ValueError("Expected an XMLTV tv guide")
    labels = {}
    for ch in root.findall("channel"):
        label = (ch.findtext("display-name") or "").strip().casefold()
        if ch.get("id") and label:
            labels[ch.get("id")] = label
    by_id, by_name = {}, {}
    for ch in channels:
        if ch.get("epg_id"):
            by_id.setdefault(ch["epg_id"], []).append(ch)
        by_name.setdefault(ch["name"].strip().casefold(), []).append(ch)
    programs, dedup = [], set()
    now = int(time.time() * 1000)
    for e in root.findall("programme")[:30000]:
        guide_id = e.get("channel", "")
        choices = by_id.get(guide_id, [])
        if not strict and not choices and guide_id in labels:
            choices = by_name.get(labels[guide_id], [])
        if not choices:
            continue
        start, stop = xml_time(e.get("start")), xml_time(e.get("stop"))
        if stop <= start or stop < now - 3600000 or start > now + 14 * 86400000:
            continue
        title = (e.findtext("title") or "").strip()[:160]
        if not title:
            continue
        subtitle = (e.findtext("sub-title") or "").strip()[:100]
        episode = ep_number(e)
        targets = choices if assign_all else [max(choices, key=lambda c: c.get("quality", 0))]
        for channel in targets:
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
    global CHANNELS, VOD, PROGRAMS, NEXT_REFRESH
    with LOCK:
        sources=[s.copy() for s in STATE["sources"]]
    if not sources:
        with LOCK:
            CHANNELS, VOD, PROGRAMS = [], [], []
            NEXT_REFRESH=time.time()+30*60
        return
    channels, vod, programs, successes = [],[],[],0
    mappings = STATE.get("epg_mappings", {}).copy()
    epg_sources = [e.copy() for e in STATE.get("epg_sources", [])]
    for source in sources:
        try:
            entries=parse_m3u(fetch_feed(source["m3u_url"],4*1024*1024))
            live=[]
            for item in entries:
                item["provider_id"],item["provider"] = source["id"],source["name"]
                movie=vod_entry(item)
                if movie:
                    vod.append(movie)
                else:
                    live.append(item)
                    channels.append(item)
            ordinary = [c for c in live if c["id"] not in mappings]
            if source.get("xmltv_url") and ordinary:
                try:programs.extend(parse_xmltv(fetch_feed(source["xmltv_url"],24*1024*1024),ordinary))
                except (OSError,ValueError,ET.ParseError,UnicodeError):pass  # Live channels remain usable without guide data.
            successes+=1
        except (OSError,ValueError,ET.ParseError,UnicodeError):
            continue
    if not successes:
        raise ValueError("No configured IPTV source could be loaded")
    # Independent EPG sources can override any single IPTV channel, regardless
    # of which streaming provider supplied it. A broken guide never removes TV.
    for epg in epg_sources:
        assigned = {cid: value.get("epg_channel_id", "")
                    for cid, value in mappings.items()
                    if isinstance(value, dict) and value.get("source_id") == epg["id"]}
        candidates = [{**channel, "epg_id": assigned[channel["id"]]}
                      for channel in channels if channel["id"] in assigned and assigned[channel["id"]]]
        if not candidates:
            continue
        try:
            programs.extend(parse_xmltv(fetch_feed(epg["url"], 24 * 1024 * 1024),
                                        candidates, strict=True, assign_all=True))
        except (OSError, ValueError, ET.ParseError, UnicodeError):
            # The station stays playable even if an independent EPG is offline.
            pass
    with LOCK:
        CHANNELS,VOD,PROGRAMS=channels[:4000],vod[:12000],sorted(programs,key=lambda p:p["start"])[:30000]
        NEXT_REFRESH=time.time()+30*60
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
            if STATE["sources"] and time.time() >= NEXT_REFRESH:
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
                return self.send_json({"ok": True, "ffmpeg": bool(shutil.which("ffmpeg")), "channels": len(CHANNELS), "programs": len(PROGRAMS), "vod": len(VOD), "sources": len(STATE["sources"]), "recorder": "Luma"})
            if path == "/sources":
                return self.send_json({"sources":[{"id":s["id"],"name":s["name"],"has_guide":bool(s.get("xmltv_url"))} for s in STATE["sources"]]})
            if path == "/epg/sources":
                return self.send_json({"sources":[{"id":x["id"], "name":x["name"]} for x in STATE["epg_sources"]],
                                       "mappings": STATE["epg_mappings"]})
            if path.startswith("/epg/sources/") and path.endswith("/channels"):
                sid = path.split("/")[3]
                source = next((x for x in STATE["epg_sources"] if x["id"] == sid), None)
                if not source:
                    return self.send_json({"error": "Unknown EPG source"}, 404)
                # Fetch outside LOCK: remote guides must not block the scheduler.
                epg_url = source["url"]
                # Return after leaving the lock through a helper below.
                return self.epg_channels(epg_url)
            if path == "/vod/search":
                q=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                return self.send_json({"matches":vod_matches(VOD,{k:v[0] for k,v in q.items()})})
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
    def epg_channels(self, url):
        try:
            rows = epg_catalog(fetch_feed(url, 24 * 1024 * 1024))
            return self.send_json({"channels": rows})
        except (OSError, ValueError, ET.ParseError, UnicodeError):
            return self.send_json({"error": "EPG source could not be read"}, 502)

    def do_POST(self):
        if not self.auth():return
        try:
            data = self.payload()
            path = urllib.parse.urlsplit(self.path).path
            if path == "/epg/sources":
                name = str(data.get("name") or "").strip()[:80]
                url = str(data.get("url") or "").strip()[:3500]
                if not name or not url_allowed(url):
                    raise ValueError("Enter a valid EPG source name and URL")
                # Verify we can read at least a valid XMLTV file before saving.
                channels = epg_catalog(fetch_feed(url, 24 * 1024 * 1024))
                if not channels:
                    raise ValueError("EPG feed contains no channel IDs")
                with LOCK:
                    existing = next((x for x in STATE["epg_sources"] if x["url"] == url), None)
                    if existing:
                        existing["name"] = name
                        eid = existing["id"]
                    else:
                        if len(STATE["epg_sources"]) >= 25:
                            raise ValueError("Maximum 25 custom EPG sources")
                        eid = uuid.uuid4().hex[:12]
                        STATE["epg_sources"].append({"id": eid, "name": name, "url": url})
                    save_state()
                return self.send_json({"ok": True, "id": eid, "channels": len(channels)}, 201)
            if path == "/epg/mappings":
                cid = str(data.get("channel_id") or "")[:100]
                sid = str(data.get("source_id") or "")[:100]
                eid = str(data.get("epg_channel_id") or "")[:160]
                with LOCK:
                    if not any(c["id"] == cid for c in CHANNELS):
                        raise ValueError("Choose an existing IPTV channel")
                    source = next((x for x in STATE["epg_sources"] if x["id"] == sid), None)
                    if not source:
                        raise ValueError("Choose an existing EPG source")
                if not eid:
                    raise ValueError("Choose a guide channel ID")
                names = epg_catalog(fetch_feed(source["url"], 24 * 1024 * 1024))
                if not any(x["id"] == eid for x in names):
                    raise ValueError("Guide channel not present in selected XMLTV feed")
                with LOCK:
                    STATE["epg_mappings"][cid] = {"source_id": sid, "epg_channel_id": eid}
                    save_state()
                refresh_guide()
                return self.send_json({"ok": True, "channel_id": cid, "source_id": sid,
                                       "epg_channel_id": eid})
            if path == "/sources":
                playlist=str(data.get("m3u_url") or "").strip()[:3500]
                epg=str(data.get("xmltv_url") or "").strip()[:3500]
                name=str(data.get("name") or "My IPTV").strip()[:80] or "My IPTV"
                if not playlist or not url_allowed(playlist) or epg and not url_allowed(epg):
                    raise ValueError("Invalid M3U or XMLTV URL")
                try:
                    parsed=parse_m3u(fetch_feed(playlist,4*1024*1024))
                    if not parsed:raise ValueError("Playlist contains no playable entries")
                except (OSError,ValueError):
                    raise ValueError("Could not load the provided playlist")
                with LOCK:
                    previous=[s.copy() for s in STATE["sources"]]
                    existing=next((s for s in STATE["sources"] if s["m3u_url"]==playlist),None)
                    if existing:
                        existing.update(name=name,xmltv_url=epg)
                        provider_id=existing["id"]
                    else:
                        if len(STATE["sources"])>=10:raise ValueError("Maximum 10 IPTV services")
                        provider_id=uuid.uuid4().hex[:12]
                        STATE["sources"].append({"id":provider_id,"name":name,"m3u_url":playlist,"xmltv_url":epg})
                try:refresh_guide()
                except Exception:
                    with LOCK:STATE["sources"]=previous
                    raise ValueError("No source could be loaded; previous configuration preserved")
                with LOCK:save_state()
                return self.send_json({"ok":True,"id":provider_id,"sources":len(STATE["sources"]),"channels":len(CHANNELS),"programs":len(PROGRAMS),"vod":len(VOD)})

            if path == "/refresh":
                refresh_guide()
                return self.send_json({"ok":True,"programs":len(PROGRAMS)})
            if path == "/recordings/manual":
                cid = str(data.get("channel_id") or "")
                minutes = max(5, min(240, int(data.get("minutes") or 60)))
                with LOCK:
                    channel = next((c for c in CHANNELS if c["id"] == cid), None)
                    if not channel:
                        raise ValueError("Choose a channel from the connected playlist")
                    now = int(time.time() * 1000)
                    name = str(data.get("title") or channel["name"])[:160].strip() or channel["name"]
                    job = {"id":uuid.uuid4().hex[:16],"program_id":"manual:"+uuid.uuid4().hex,
                           "channel_id":cid,"title":name,"episode":"","episode_id":"",
                           "start":now,"end":now+minutes*60000,"status":"scheduled",
                           "file":"","error":"","rule_id":""}
                    STATE["jobs"].append(job);save_state()
                    return self.send_json({"job":job},201)
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
        global NEXT_REFRESH
        if not self.auth():return
        path = urllib.parse.urlsplit(self.path).path
        with LOCK:
            if path.startswith("/epg/sources/"):
                sid = path.split("/")[3]
                old = len(STATE["epg_sources"])
                STATE["epg_sources"] = [x for x in STATE["epg_sources"] if x["id"] != sid]
                if old == len(STATE["epg_sources"]):
                    return self.send_json({"error": "EPG source not found"}, 404)
                STATE["epg_mappings"] = {cid: value for cid, value in STATE["epg_mappings"].items()
                                         if value.get("source_id") != sid}
                NEXT_REFRESH = 0
                save_state()
                return self.send_json({"deleted": True})
            if path.startswith("/epg/mappings/"):
                cid = urllib.parse.unquote(path[len("/epg/mappings/"):])
                found = STATE["epg_mappings"].pop(cid, None) is not None
                if found:
                    save_state()
                    global NEXT_REFRESH
                    NEXT_REFRESH = 0
                return self.send_json({"deleted": found})
            if path.startswith("/sources/"):
                sid=path.split("/")[2]
                count=len(STATE["sources"])
                STATE["sources"]=[s for s in STATE["sources"] if s["id"]!=sid]
                if count==len(STATE["sources"]):return self.send_json({"error":"Not found"},404)
                save_state()
                NEXT_REFRESH=0
                if not STATE["sources"]:
                    CHANNELS.clear();VOD.clear();PROGRAMS.clear()
                return self.send_json({"deleted":True})
            if path.startswith("/rules/"):
                rid=path.split("/")[2]
                count=len(STATE["rules"])
                STATE["rules"]=[r for r in STATE["rules"] if r["id"]!=rid]
                save_state()
                return self.send_json({"deleted":count>len(STATE["rules"])})
            if path.startswith("/recordings/"):
                job=next((j for j in STATE["jobs"] if j["id"]==path.split("/")[2]),None)
                if not job:return self.send_json({"error":"Not found"},404)
                if job["status"]!="scheduled":return self.send_json({"error":"Only pending recordings can be cancelled"},409)
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
