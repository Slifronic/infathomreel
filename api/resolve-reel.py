"""Resolves an Instagram permalink to actual media bytes via yt-dlp.

Meta's messaging webhook hands us a permalink page for shared Reels/posts,
not a direct media file, and Instagram blocks plain server-side scraping of
that page. yt-dlp is free, open-source, and actively maintained against
exactly this kind of anti-bot hardening, so it's the reliable way to get the
real file(s).

Instagram now hard-blocks anonymous (logged-out) access outright ("You have
exceeded the rate-limit for accessing posts anonymously") rather than just
occasionally erroring — so yt-dlp needs real session cookies. IG_COOKIES_TXT
holds a Netscape-format cookies.txt exported from a logged-in account; it's
written to a temp file per-request and passed to yt-dlp via --cookies.

Two modes:
- Default (single item): a Reel or single-image post. Uses --no-playlist so
  a post doesn't accidentally pull in unrelated content.
- carousel=true: a multi-image/video carousel post. Deliberately omits
  --no-playlist so yt-dlp extracts every slide, and returns them all as a
  JSON array instead of a single binary response.
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import base64
import json
import mimetypes
import subprocess
import tempfile
import time
import os
import sys

# Instagram intermittently returns an empty media response to yt-dlp even for
# a post that resolves fine moments later (confirmed by retesting the same
# URL back-to-back) — retry a few times before giving up.
MAX_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 2

IG_COOKIES_TXT = os.environ.get("IG_COOKIES_TXT")


def _cookie_args(tmpdir: str) -> list[str]:
    """Writes IG_COOKIES_TXT (if set) to a file in tmpdir and returns the
    --cookies args for yt-dlp, or [] if no cookies are configured."""
    if not IG_COOKIES_TXT:
        return []
    cookie_path = os.path.join(tmpdir, "cookies.txt")
    with open(cookie_path, "w") as f:
        f.write(IG_COOKIES_TXT)
    return ["--cookies", cookie_path]


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        url = (query.get("url") or [None])[0]
        is_carousel = (query.get("carousel") or [""])[0] == "true"
        if not url:
            self._error(400, "Missing url parameter")
            return

        if is_carousel:
            self._handle_carousel(url)
        else:
            self._handle_single(url)

    def _handle_single(self, url: str) -> None:
        last_error = ""
        for attempt in range(1, MAX_ATTEMPTS + 1):
            with tempfile.TemporaryDirectory() as tmpdir:
                out_path = os.path.join(tmpdir, "media.%(ext)s")
                try:
                    result = subprocess.run(
                        [
                            sys.executable, "-m", "yt_dlp",
                            "-f", "best[ext=mp4]/best",
                            "--no-playlist",
                            *_cookie_args(tmpdir),
                            "-o", out_path,
                            url,
                        ],
                        capture_output=True,
                        text=True,
                        timeout=60,
                    )
                except subprocess.TimeoutExpired:
                    last_error = "yt-dlp timed out"
                    continue

                files = os.listdir(tmpdir) if result.returncode == 0 else []
                if result.returncode != 0 or not files:
                    last_error = result.stderr[-1500:]
                    print(f"Attempt {attempt}/{MAX_ATTEMPTS} failed: {last_error}")
                    if attempt < MAX_ATTEMPTS:
                        time.sleep(RETRY_DELAY_SECONDS)
                    continue

                out_file = os.path.join(tmpdir, files[0])
                content_type = mimetypes.guess_type(out_file)[0] or "video/mp4"
                with open(out_file, "rb") as f:
                    data = f.read()

                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

        self._error(502, f"yt-dlp failed after {MAX_ATTEMPTS} attempts: {last_error}")

    def _handle_carousel(self, url: str) -> None:
        last_error = ""
        for attempt in range(1, MAX_ATTEMPTS + 1):
            with tempfile.TemporaryDirectory() as tmpdir:
                out_template = os.path.join(tmpdir, "%(playlist_index)03d.%(ext)s")
                try:
                    result = subprocess.run(
                        [
                            sys.executable, "-m", "yt_dlp",
                            "-f", "best[ext=mp4]/best",
                            # No --no-playlist here on purpose: a carousel post is
                            # exposed to yt-dlp as a playlist of its slides, and we
                            # want every slide, not just the first.
                            *_cookie_args(tmpdir),
                            "-o", out_template,
                            url,
                        ],
                        capture_output=True,
                        text=True,
                        timeout=90,
                    )
                except subprocess.TimeoutExpired:
                    last_error = "yt-dlp timed out"
                    continue

                files = sorted(os.listdir(tmpdir)) if result.returncode == 0 else []
                if result.returncode != 0 or not files:
                    last_error = result.stderr[-1500:]
                    print(f"Attempt {attempt}/{MAX_ATTEMPTS} failed: {last_error}")
                    if attempt < MAX_ATTEMPTS:
                        time.sleep(RETRY_DELAY_SECONDS)
                    continue

                items = []
                for fname in files:
                    fpath = os.path.join(tmpdir, fname)
                    content_type = mimetypes.guess_type(fpath)[0] or "application/octet-stream"
                    with open(fpath, "rb") as f:
                        items.append({
                            "contentType": content_type,
                            "dataBase64": base64.b64encode(f.read()).decode("ascii"),
                        })

                body = json.dumps({"items": items}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

        self._error(502, f"yt-dlp failed after {MAX_ATTEMPTS} attempts: {last_error}")

    def _error(self, code: int, message: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(message.encode())
