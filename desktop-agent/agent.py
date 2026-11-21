"""JARVIS local desktop agent — safe foundation (read-only).

Run with: py agent.py
This first version exposes health/status only. It does not execute commands,
read files, or monitor folders.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import secrets
import time

HOST = "127.0.0.1"
PORT = 8765
ALLOWED_ORIGIN = "https://mayank1530721.github.io"
TOKEN = secrets.token_urlsafe(32)
STARTED = time.time()


class Handler(BaseHTTPRequestHandler):
    server_version = "JarvisAgent/0.1"

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin == ALLOWED_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True, "service": "JARVIS Desktop Agent", "version": "0.1"})
            return
        if self.path == "/api/status":
            supplied = self.headers.get("Authorization", "")
            if not secrets.compare_digest(supplied, "Bearer " + TOKEN):
                self._json(401, {"ok": False, "error": "Unauthorized"})
                return
            self._json(200, {
                "ok": True,
                "service": "JARVIS Desktop Agent",
                "version": "0.1",
                "uptime_seconds": round(time.time() - STARTED),
                "capabilities": ["health", "status"],
                "execution_enabled": False
            })
            return
        self._json(404, {"ok": False, "error": "Not found"})

    def log_message(self, fmt, *args):
        print("[agent] " + (fmt % args))


if __name__ == "__main__":
    print("\nJARVIS Desktop Agent v0.1")
    print("Listening only on http://127.0.0.1:%d" % PORT)
    print("Temporary dashboard token (keep private):\n%s\n" % TOKEN)
    print("This version is read-only; no commands or file access are enabled.\n")
    try:
        ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\nJARVIS Desktop Agent stopped.")
