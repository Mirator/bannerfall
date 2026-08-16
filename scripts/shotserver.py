"""Tiny screenshot-upload server: page POSTs canvas dataURLs, we write PNG/JPEG files.
Usage: python scripts/shotserver.py   (listens on :8475, writes to shots/)
"""
import base64
import os
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "shots")
os.makedirs(OUT, exist_ok=True)

MAX_BODY = 20 * 1024 * 1024  # a screenshot dataURL never needs more than this; caps OOM risk
_LOCAL_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _origin_allowed(self):
        # this server has no auth; without an origin check, ANY website the browser has
        # open can silently POST files into shots/ (wildcard ACAO used to allow exactly
        # that). Only allow same-machine callers — a bare request with no Origin header
        # (curl, a same-origin page) is allowed too, since browsers always send Origin
        # for cross-origin requests.
        origin = self.headers.get("Origin")
        return not origin or _LOCAL_ORIGIN.match(origin)

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin and self._origin_allowed():
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if not self._origin_allowed():
            self.send_response(403)
            self.end_headers()
            return
        try:
            name = re.sub(r"[^a-zA-Z0-9_-]", "", parse_qs(urlparse(self.path).query).get("name", ["shot"])[0]) or "shot"
            n = int(self.headers.get("Content-Length", 0))
            if n > MAX_BODY:
                self.send_response(413)
                self._cors()
                self.end_headers()
                self.wfile.write(b"payload too large")
                return
            body = self.rfile.read(n).decode("utf-8", "ignore")
            m = re.match(r"data:image/(png|jpeg);base64,(.*)", body, re.S)
            ext = m.group(1).replace("jpeg", "jpg") if m else "png"
            data = base64.b64decode(m.group(2) if m else body)
            path = os.path.join(OUT, f"{name}.{ext}")
            with open(path, "wb") as f:
                f.write(data)
            self.send_response(200)
            self._cors()
            self.end_headers()
            self.wfile.write(path.encode())
        except Exception as e:  # noqa
            self.send_response(500)
            self._cors()
            self.end_headers()
            self.wfile.write(str(e).encode())


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8475), H).serve_forever()
