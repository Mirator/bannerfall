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

    def handle_one_request(self):
        # A browser context closing mid-response resets the socket, and the default
        # handler prints a traceback for it. Harmless in a dev loop, but Plan 047 runs
        # several contexts at once and every one of them tears down its connections at
        # the end of a measurement, so CI logs filled with BrokenPipeError stacks that
        # look like failures and are not. A dropped client is not this server's problem.
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8474))
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
