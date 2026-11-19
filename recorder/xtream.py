"""Xtream Codes-compatible IPTV provider adapter for user-authorized accounts.

Only fetch the provider-supplied player_api.php and XMLTV endpoints. Never
publish credentials in health diagnostics, logs, or returned provider lists.
"""
import hashlib
import json
import re
import urllib.parse


def panel_url(server):
    parts = urllib.parse.urlsplit(str(server).strip().rstrip("/"))
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
        raise ValueError("Xtream server must be a valid http(s) URL without embedded credentials")
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/"), "", "")).rstrip("/")


def api_url(server, username, password, action=None, **args):
    base = panel_url(server)
    query = {"username": username, "password": password}
    if action:
        query["action"] = action
    query.update(args)
    return base + "/player_api.php?" + urllib.parse.urlencode(query)


def epg_url(server, username, password):
    return panel_url(server) + "/xmltv.php?" + urllib.parse.urlencode(
        {"username": username, "password": password})


def valid_credentials(source):
    server = panel_url(source.get("server", ""))
    user = str(source.get("username") or "")
    password = str(source.get("password") or "")
    if not user or not password or len(user) > 180 or len(password) > 180:
        raise ValueError("Provide a valid Xtream username and password")
    return server, user, password


def request_json(source, action, fetch, **args):
    server, username, password = valid_credentials(source)
    result = json.loads(fetch(api_url(server, username, password, action, **args), 8 * 1024 * 1024))
    if not isinstance(result, (list, dict)):
        raise ValueError("Xtream returned an unexpected response")
    return result


def make_stream_url(server, user, password, media, stream_id, extension):
    if not re.fullmatch(r"\d{1,12}", str(stream_id)):
        return ""
    if not re.fullmatch(r"[A-Za-z0-9]{1,8}", str(extension)):
        return ""
    return panel_url(server) + "/" + media + "/" + "/".join([
        urllib.parse.quote(user, safe=""),
        urllib.parse.quote(password, safe=""),
        str(stream_id) + "." + extension
    ])


def load_catalog(source, fetch):
    server, user, password = valid_credentials(source)
    categories = request_json(source, "get_live_categories", fetch)
    live = request_json(source, "get_live_streams", fetch)
    if not isinstance(categories, list) or not isinstance(live, list):
        raise ValueError("Xtream live channels or categories are unavailable")
    category_names = {str(x.get("category_id")): str(x.get("category_name") or "Live TV")[:70]
                      for x in categories[:2000] if isinstance(x, dict)}
    format_name = "m3u8" if str(source.get("output", "m3u8")).lower() == "m3u8" else "ts"
    channels = []
    for row in live[:4000]:
        if not isinstance(row, dict):
            continue
        stream_id = row.get("stream_id")
        url = make_stream_url(server, user, password, "live", stream_id, format_name)
        if not url:
            continue
        name = str(row.get("name") or "").strip()[:120]
        if not name:
            continue
        identity = hashlib.sha256((str(source["id"]) + "|" + str(stream_id)).encode()).hexdigest()[:18]
        icon = str(row.get("stream_icon") or "")[:400]
        if not icon.startswith(("https://", "http://")):
            icon = ""
        channels.append({
            "id": "xc:" + identity, "name": name,
            "epg_id": str(row.get("epg_channel_id") or "")[:160],
            "logo": icon, "number": str(row.get("num") or "")[:12],
            "group": category_names.get(str(row.get("category_id")), "Live TV"),
            "quality": 2 if re.search(r"\b(?:4k|uhd)\b", name, re.I)
                       else 1 if re.search(r"\b(?:hd|1080p|fhd)\b", name, re.I) else 0,
            "url": url
        })
    vod = []
    try:
        movies = request_json(source, "get_vod_streams", fetch)
        if not isinstance(movies, list):
            movies = []
        for row in movies[:9000]:
            if not isinstance(row, dict):
                continue
            ext = str(row.get("container_extension") or "mp4").lower()
            if ext not in ("mp4", "mkv", "avi", "ts", "mov"):
                continue
            url = make_stream_url(server, user, password, "movie", row.get("stream_id"), ext)
            if url:
                vod.append({
                    "id": "xcvod:" + str(row["stream_id"]), "name": str(row.get("name") or "")[:150],
                    "group": "Movies", "url": url, "quality": 0
                })
    except (ValueError, OSError, json.JSONDecodeError):
        pass  # Live TV must remain functional even if movie API is unavailable.
    series = []
    try:
        listing = request_json(source, "get_series", fetch)
        if isinstance(listing, list):
            series = [
                {"id": x.get("series_id"), "name": str(x.get("name") or "")[:160],
                 "year": str(x.get("releaseDate") or "")[:4], "provider_id": source["id"]}
                for x in listing[:7000]
                if isinstance(x, dict) and str(x.get("series_id", "")).isdigit()
            ]
    except (ValueError, OSError, json.JSONDecodeError):
        pass
    return channels, vod, series


def episode_matches(source, series_catalog, args, fetch):
    server, user, password = valid_credentials(source)
    title = re.sub(r"[^\w]+", " ", str(args.get("title") or "").casefold()).strip()
    if not title or args.get("type") != "series":
        return []
    try:
        season = int(args.get("season", 0))
        episode = int(args.get("episode", 0))
    except (TypeError, ValueError):
        return []
    if season < 1 or episode < 1:
        return []
    results = []
    for show in series_catalog:
        if re.sub(r"[^\w]+", " ", show["name"].casefold()).strip() != title:
            continue
        info = request_json(source, "get_series_info", fetch, series_id=show["id"])
        groups = info.get("episodes", {}) if isinstance(info, dict) else {}
        for entry in groups.get(str(season), []) if isinstance(groups, dict) else []:
            if not isinstance(entry, dict):
                continue
            try:
                num = int(entry.get("episode_num", 0))
            except (TypeError, ValueError):
                continue
            if num != episode:
                continue
            ext = str(entry.get("container_extension") or "mp4").lower()
            if ext not in ("mp4", "mkv", "avi", "ts", "mov"):
                continue
            url = make_stream_url(server, user, password, "series", entry.get("id"), ext)
            if url:
                results.append({"name": show["name"] + f" S{season:02d}E{episode:02d}",
                                "title": show["name"], "type": "series", "url": url,
                                "season": season, "episode_number": episode,
                                "provider": source["name"], "quality": 0})
        if len(results) >= 15:
            break
    return results
