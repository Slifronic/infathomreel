"""Resolves an Instagram permalink (reel/post) to its actual video bytes via yt-dlp.

Meta's messaging webhook hands us a permalink page for shared Reels, not a
direct video URL, and Instagram blocks plain server-side scraping of that
page. yt-dlp is free, open-source, and actively maintained against exactly
this kind of anti-bot hardening, so it's the reliable way to get the real
video file.
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import subprocess
import tempfile
import os
import sys


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        url = (query.get("url") or [None])[0]
        if not url:
            self._error(400, "Missing url parameter")
            return

        with tempfile.TemporaryDirectory() as tmpdir:
            out_path = os.path.join(tmpdir, "video.mp4")
            try:
                result = subprocess.run(
                    [
                        sys.executable, "-m", "yt_dlp",
                        "-f", "best[ext=mp4]/best",
                        "--no-playlist",
                        "-o", out_path,
                        url,
                    ],
                    capture_output=True,
                    text=True,
                    timeout=90,
                )
            except subprocess.TimeoutExpired:
                self._error(504, "yt-dlp timed out")
                return

            if result.returncode != 0 or not os.path.exists(out_path):
                self._error(502, f"yt-dlp failed: {result.stderr[-1500:]}")
                return

            with open(out_path, "rb") as f:
                data = f.read()

        self.send_response(200)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _error(self, code: int, message: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(message.encode())
