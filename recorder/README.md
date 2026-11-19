# Luma IPTV Recorder (self-hosted)

**Purpose:** scheduled one-time and series recordings from **IPTV streams you are authorized to record**. The always-on host writes Transport Stream (.ts) files to its `./recordings` directory. The website can download completed recordings. A completely powered-off TV box cannot record; keep this service on a powered NAS, PC, VPS, or supported box.

## Setup

1. Install Docker + Docker Compose on an always-on machine, point your own domain to its public IP, and allow ports 80/443 for Caddy HTTPS. A valid publicly trusted HTTPS certificate is required when accessing the recorder from the GitHub Pages web app. If you use a private network, use a reverse proxy or VPN that supplies HTTPS instead.
2. Copy `.env.example` to `.env`, create a unique strong `LUMA_RECORDER_TOKEN` (at least 24 characters), and set `RECORDER_DOMAIN`. Do not commit `.env`. Configure authorized M3U and XMLTV sources in the Luma IPTV tab.
3. From this folder run `docker compose up -d --build`. Choose `https://your-recorder-domain` and enter the token in Luma → Live TV → Recorder settings.
4. Use the guide to schedule an airing or create a series rule. The recorder refreshes the guide approximately every 30 minutes, starts up to 3 concurrent FFmpeg tasks, writes to your recordings volume, and can serve finished files for download. Interrupted jobs are marked interrupted if the machine shuts down after the airing.

## Series modes

- **New only (guide confirmed):** Requires XMLTV `<new/>` or `<premiere/>` and rejects explicit repeats. Some providers do not mark every new episode; these will not be auto-recorded.
- **Every unique episode:** Uses a stable XMLTV episode number when present, or a normalized subtitle / sufficiently detailed episode description fingerprint. It records reruns of episodes not previously recorded, and skips duplicates after they are scheduled or completed. A reused description can occasionally cause a false match; ambiguous brief descriptions are not classified as unique.
- **New only:** Still requires XMLTV `<new/>` / `<premiere/>` and rejects explicit reruns. A description cannot prove a first-run broadcast.
- **All airings:** Records each guide airing, including repeats, until you remove the rule.

Privacy/security: Use trusted playlist sources, HTTPS and a secret bearer token. The service blocks non-public internet hosts by default; `LUMA_ALLOW_PRIVATE_SOURCES=true` opts into LAN playlist servers. Playlist links frequently contain credentials—never post them in issues or logs. The service is for individually authorized content; no DRM bypass is included.

The guide uses XMLTV, so no paid third-party TV guide API is required if your IPTV provider supplies a compatible XMLTV feed. Recording guide quality depends on the feed. Direct browser playback depends on the codec, player and CORS. This companion does not magically keep a powered-off TV box recording; it must remain powered and reachable.

**Record Channel Now:** When an XMLTV guide has no listing, open the channel and choose a 30–240 minute direct recording. The always-on companion must be connected; it writes to its own recordings volume, where you can save the resulting file to your device.


### More than one IPTV service

Luma's recorder now supports up to **10 named M3U/XMLTV providers**. Enter each playlist and optional guide in Live TV, then choose **Sync to recorder**; syncing an identical URL updates that service instead of duplicating it. `GET /sources` returns provider names without revealing playlist credentials and `DELETE /sources/<id>` removes a provider. Each service's XMLTV matching is kept within its own channels; VOD movie and episode sources are also labeled by provider.


## HEVC (H.265/x265) and recording quality

Successful captures are checked with ffprobe for a decodable video track, nearly complete media duration, and an on-time recording start. Only validated captures are marked **complete**. A separate worker then converts the original TS to H.265/HEVC MP4 using ffmpeg's real \`libx265\` encoder (CRF 27, fast preset, AAC audio). The original is only removed once the compressed output is **smaller**, independently probe-verified, and successfully committed to DVR history. If compression fails or is not beneficial, the original is retained; incomplete recordings are never deleted by compression.

For a failed, partial, interrupted, or missed exact-episode recording, the scheduler searches **every channel across every connected IPTV provider and EPG feed** for the soonest future airing of that **specific episode**. It can retry on a different channel or later the same day. Identification uses the exact season/episode value where available, or a sufficiently descriptive episode subtitle/description. Ambiguous listings are deliberately not auto-matched. Failures remain in the history and a separately linked retry job is created; up to five additional attempts are considered as the guide refreshes every 30 minutes. An unavailable EPG cannot guarantee discovery until the feed becomes accessible.

### Watch recordings inside Luma
Completed recordings support **Watch in Luma** using a scoped, HMAC-signed playback ticket issued only after authenticated access. The four-hour ticket authorizes only the selected completed recording. Playback streams through byte-range HTTP requests, so MP4 files can seek without downloading the entire recording first. The recorder's reusable access token is not placed in the media URL. Serve the recorder over trusted HTTPS; protect playback links because anyone possessing a still-valid ticket can watch that one recording until it expires. Original MPEG-TS recordings may require the native Luma player, and playback codecs vary by device. The always-on recorder must remain powered; this feature does not make a powered-off phone record television.
