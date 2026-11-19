"""Capture integrity, cross-provider episode matching and safe H.265 postprocessing.

The recorder keeps the original transport stream until the HEVC replacement
has passed media-duration and size checks. No original is removed on errors.
"""
import json
import os
import subprocess
from pathlib import Path

COVERAGE = 0.99
MAX_ATTEMPTS = 5


def select_rerun(job, programs, channels, attempted, identity, now_ms):
    """Earliest complete future showing of the EXACT episode, on ANY channel."""
    expected = job.get("episode_key") or identity(job)
    if not expected:
        return None  # Ambiguous EPG descriptions must never cause false reruns.
    candidates = []
    for p in programs:
        if identity(p) != expected or p.get("id") in attempted:
            continue
        if p.get("channel_id") not in channels:
            continue
        if int(p.get("start", 0)) < now_ms + 5000 or int(p.get("end", 0)) <= int(p.get("start", 0)):
            continue
        candidates.append(p)
    return min(candidates, key=lambda p: (
        p["start"], -int(channels[p["channel_id"]].get("quality", 0)), str(p["channel_id"])
    )) if candidates else None


def probe(path):
    """Require an actual video stream and a parseable media duration."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration:stream=codec_type,codec_name,duration",
         "-of", "json", str(path)],
        capture_output=True, text=True, timeout=45, check=False)
    if result.returncode:
        raise ValueError("ffprobe could not read recording")
    data = json.loads(result.stdout)
    videos = [s for s in data.get("streams", []) if s.get("codec_type") == "video"]
    if not videos:
        raise ValueError("No playable video track")
    durations = [data.get("format", {}).get("duration")] + [x.get("duration") for x in videos]
    seconds = []
    for value in durations:
        try:
            n = float(value)
            if 0 < n < 48 * 3600:
                seconds.append(n)
        except (ValueError, TypeError):
            pass
    if not seconds:
        raise ValueError("Recording has no verifiable duration")
    return {"duration": max(seconds), "codec": videos[0].get("codec_name", "")}


def verify_capture(job, path, return_code, started_at, inspect=probe):
    """Check media *content*, not merely a successful FFmpeg exit or file size."""
    p = Path(path)
    if return_code != 0:
        return False, "The source stopped before recording finished"
    if not p.is_file() or p.stat().st_size < 4096:
        return False, "Recording is missing or empty"
    expected = max(1, (int(job["end"]) - int(job["start"])) / 1000)
    late = max(0, started_at - int(job["start"]) / 1000)
    if late > max(15, expected * (1 - COVERAGE) / 2):
        return False, "Recording started after the episode began"
    try:
        inspected = inspect(p)
    except (ValueError, OSError, json.JSONDecodeError, subprocess.TimeoutExpired):
        return False, "Recording duration/video track could not be verified"
    minimum = max(1, expected * COVERAGE - 10)
    if inspected["duration"] < minimum:
        return False, "Incomplete episode: %.0f of %.0f seconds" % (inspected["duration"], expected)
    return True, ""


def hevc_command(source, dest, crf=27, preset="fast"):
    """Produce a real libx265 video, preserve audio, and write Apple-friendly MP4."""
    crf = max(20, min(34, int(crf)))
    if preset not in ("ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow"):
        preset = "fast"
    return [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(source), "-map", "0:v:0", "-map", "0:a?",
        "-c:v", "libx265", "-preset", preset, "-crf", str(crf),
        "-pix_fmt", "yuv420p", "-tag:v", "hvc1",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(dest)]


def compress_verified(source, crf=27, preset="fast", inspect=probe, execute=subprocess.run):
    """Return (file, bytes_saved, reason). Keep raw .ts on any failure."""
    source = Path(source)
    pending = source.with_suffix(".hevc.pending.mp4")
    output = source.with_suffix(".hevc.mp4")
    try:
        original = inspect(source)
        if original["codec"] == "hevc":
            return source, 0, "already_hevc"
        result = execute(hevc_command(source, pending, crf, preset),
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
                         timeout=max(180, min(6*3600, int(original["duration"] * 5))))
        if result.returncode != 0 or not pending.is_file():
            raise ValueError("HEVC encoder failed")
        before, after = source.stat().st_size, pending.stat().st_size
        if after < 4096 or after >= before:
            raise ValueError("H.265 was not smaller than original")
        encoded = inspect(pending)
        if encoded["codec"] != "hevc" or encoded["duration"] < original["duration"] * 0.985:
            raise ValueError("HEVC file did not retain the full episode")
        os.replace(pending, output)
        return output, before - after, "hevc_complete"
    except (OSError, ValueError, TypeError, json.JSONDecodeError, subprocess.TimeoutExpired):
        return source, 0, "hevc_failed_original_kept"
    finally:
        pending.unlink(missing_ok=True)
