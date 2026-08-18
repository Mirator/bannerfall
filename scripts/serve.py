"""Static dev server with caching disabled, so module edits always reload.
Usage: python scripts/serve.py  (listens on :8474, serves the project root)
"""
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8474))
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
