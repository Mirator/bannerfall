"""Tiny screenshot-upload server: page POSTs canvas dataURLs, we write PNG/JPEG files.
Usage: python scripts/shotserver.py   (listens on :8475, writes to shots/)
"""
import base64
import os
import re
from http.server import BaseHTTPRequestHandler, HTTPServer

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "shots")
os.makedirs(OUT, exist_ok=True)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        try:
            name = re.sub(r"[^a-zA-Z0-9_-]", "", self.path.split("name=")[-1]) or "shot"
            n = int(self.headers.get("Content-Length", 0))
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
