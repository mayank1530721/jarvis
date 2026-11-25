"""JARVIS local desktop agent v0.2: the hands behind ULTRON.

Run with: py agent.py            (Windows)   or   python3 agent.py
Optional: py agent.py --workspace C:\\path\\to\\folder

What it can do (all behind the bearer token it prints at startup):
  - list, read and write files, but ONLY inside the workspace folder
  - run shell commands, with the workspace (or a folder inside it) as the start folder

What it cannot do: delete through the file API, listen on the network (127.0.0.1 only),
or accept calls from any website other than the origins you allow.

Important: file calls are confined to the workspace, but a shell command runs with YOUR
permissions and can reach anything you can. That is why the Jarvis page asks you to
approve every command. The blocklist below only stops a few catastrophic commands and is
a speed bump, not a sandbox.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import argparse
import json
import os
import re
import secrets
import signal
import subprocess
import sys
import threading
import time

VERSION = "0.2"
HOST = "127.0.0.1"
PORT = 8765
DEFAULT_ORIGINS = ["https://mayank1530721.github.io"]
DEFAULT_WORKSPACE = os.path.join(os.path.expanduser("~"), "jarvis-workspace")

MAX_BODY = 3 * 1024 * 1024          # largest request we accept
MAX_READ = 200 * 1024               # largest file we return in one read
MAX_WRITE = 2 * 1024 * 1024         # largest file we write in one call
MAX_LIST = 500                      # most entries returned for one folder
MAX_OUTPUT = 20 * 1024              # command output kept (the end is kept, that is where errors are)
DEFAULT_TIMEOUT = 60
MAX_TIMEOUT = 600

# A few commands nobody should ever run by accident. This is a speed bump, not a sandbox.
BLOCKED = [
    r"\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\s+(-[a-z]*\s+)*(/\*?|~/?\*?|\$home/?\*?)(\s|$)",
    r"\bmkfs\b",
    r"\bdd\s+[^|;&]*\bof=/dev/",
    r":\(\)\s*\{",
    r"\bformat\s+[a-z]:",
    r"\b(del|erase)\b[^|;&]*\s/s\b[^|;&]*\s[a-z]:\\\s*$",
    r"\b(rd|rmdir)\b[^|;&]*\s/s\b[^|;&]*\s[a-z]:\\\s*$",
    r"\b(shutdown|reboot|halt|poweroff)\b",
    r"\bremove-item\b[^|;&]*-recurse[^|;&]*\s[a-z]:\\\s*$",
]
BLOCKED_RE = [re.compile(p, re.I) for p in BLOCKED]


class ApiError(Exception):
    def __init__(self, status, message):
        Exception.__init__(self, message)
        self.status = status
        self.message = message


def blocked_reason(command):
    """Return a reason string if the command matches the blocklist, else None."""
    for rx in BLOCKED_RE:
        if rx.search(command):
            return "Blocked: this command looks destructive to the whole machine. Run it yourself if you really mean it."
    return None


def resolve_in_workspace(root, rel):
    """Turn a user-supplied path into a real path that is inside root, or raise ApiError(400)."""
    rel = (rel or "").strip().replace("\\", "/")
    if rel.startswith("/") or re.match(r"^[a-zA-Z]:", rel):
        raise ApiError(400, "Use a path relative to the workspace, not an absolute one.")
    real_root = os.path.realpath(root)
    full = os.path.realpath(os.path.join(real_root, rel))
    try:
        inside = os.path.commonpath([real_root, full]) == real_root
    except ValueError:                      # different drives on Windows
        inside = False
    if not inside:
        raise ApiError(400, "That path is outside the workspace.")
    return full


def do_list(root, rel):
    full = resolve_in_workspace(root, rel)
    if not os.path.isdir(full):
        raise ApiError(404, "Not a folder.")
    entries = []
    for name in sorted(os.listdir(full), key=str.lower):
        p = os.path.join(full, name)
        isdir = os.path.isdir(p)
        try:
            size = None if isdir else os.path.getsize(p)
        except OSError:
            size = None
        entries.append({"name": name, "type": "dir" if isdir else "file", "size": size})
        if len(entries) >= MAX_LIST:
            break
    return {"ok": True, "path": rel or ".", "entries": entries, "truncated": len(os.listdir(full)) > MAX_LIST}


def do_read(root, rel, max_bytes=None):
    if not rel:
        raise ApiError(400, "Give a file path.")
    full = resolve_in_workspace(root, rel)
    if not os.path.isfile(full):
        raise ApiError(404, "No such file.")
    limit = min(int(max_bytes or MAX_READ), MAX_READ)
    size = os.path.getsize(full)
    with open(full, "rb") as f:
        raw = f.read(limit)
    if b"\x00" in raw[:4096]:
        raise ApiError(415, "That looks like a binary file, so it was not read.")
    return {"ok": True, "path": rel, "size": size, "truncated": size > limit,
            "content": raw.decode("utf-8", errors="replace")}


def do_write(root, rel, content):
    if not rel:
        raise ApiError(400, "Give a file path.")
    if not isinstance(content, str):
        raise ApiError(400, "content must be text.")
    data = content.encode("utf-8")
    if len(data) > MAX_WRITE:
        raise ApiError(413, "File is too large to write in one call.")
    full = resolve_in_workspace(root, rel)
    if os.path.isdir(full):
        raise ApiError(400, "That path is a folder.")
    existed = os.path.exists(full)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "wb") as f:
        f.write(data)
    return {"ok": True, "path": rel, "bytes": len(data), "created": not existed}


def _kill_tree(proc):
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


VIDEO_TYPES = {".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm"}


def do_put(root, rel, url, content_type):
    """Send one workspace video file to a presigned https upload URL (used for Uplika). No auth header is added."""
    import urllib.request, urllib.error
    full = resolve_in_workspace(root, rel)
    if not os.path.isfile(full):
        raise ApiError(404, "No such file.")
    ext = os.path.splitext(full)[1].lower()
    if ext not in VIDEO_TYPES:
        raise ApiError(400, "Only .mp4, .mov and .webm files can be uploaded.")
    if not isinstance(url, str) or not url.startswith("https://"):
        raise ApiError(400, "The upload address must be https.")
    if content_type != VIDEO_TYPES[ext]:
        raise ApiError(400, "Content type must be %s for %s files." % (VIDEO_TYPES[ext], ext))
    size = os.path.getsize(full)
    with open(full, "rb") as f:
        req = urllib.request.Request(url, data=f, method="PUT",
                                     headers={"Content-Type": content_type, "Content-Length": str(size)})
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                status = r.status
        except urllib.error.HTTPError as e:
            raise ApiError(502, "Upload refused with status %s." % e.code)
        except Exception as e:
            raise ApiError(502, "Upload failed: %s" % e)
    return {"ok": True, "bytes": size, "status": status, "contentType": content_type}


def do_run(root, command, cwd_rel="", timeout=None):
    if not isinstance(command, str) or not command.strip():
        raise ApiError(400, "Give a command.")
    why = blocked_reason(command)
    if why:
        raise ApiError(403, why)
    cwd = resolve_in_workspace(root, cwd_rel)
    if not os.path.isdir(cwd):
        raise ApiError(404, "The start folder does not exist.")
    try:
        secs = float(timeout) if timeout else DEFAULT_TIMEOUT
    except (TypeError, ValueError):
        secs = DEFAULT_TIMEOUT
    secs = max(1.0, min(secs, MAX_TIMEOUT))
    # Python must not cache bytecode here: when ULTRON edits a file and re-runs it within the same second
    # and the file keeps the same size (a - b to a + b), Python would reuse the stale .pyc and run the OLD code,
    # which breaks the fix-and-retest loop. Unbuffered output also keeps the order of prints and errors.
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONUNBUFFERED="1")
    kwargs = {"cwd": cwd, "shell": True, "stdin": subprocess.DEVNULL, "env": env,
              "stdout": subprocess.PIPE, "stderr": subprocess.STDOUT}
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    else:
        kwargs["start_new_session"] = True
    started = time.time()
    proc = subprocess.Popen(command, **kwargs)
    timed_out = False
    try:
        out, _ = proc.communicate(timeout=secs)
    except subprocess.TimeoutExpired:
        timed_out = True
        _kill_tree(proc)
        try:
            out, _ = proc.communicate(timeout=5)
        except Exception:
            out = b""
    text = (out or b"").decode("utf-8", errors="replace")
    clipped = len(text) > MAX_OUTPUT
    if clipped:
        text = "[output clipped, showing the last %d characters]\n%s" % (MAX_OUTPUT, text[-MAX_OUTPUT:])
    return {"ok": True, "exit_code": None if timed_out else proc.returncode, "timed_out": timed_out,
            "seconds": round(time.time() - started, 2), "output": text, "clipped": clipped}


class Handler(BaseHTTPRequestHandler):
    server_version = "JarvisAgent/" + VERSION

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin and origin in self.server.origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
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

    def _authed(self):
        supplied = self.headers.get("Authorization", "")
        return secrets.compare_digest(supplied, "Bearer " + self.server.token)

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ApiError(400, "Bad Content-Length.")
        if n > MAX_BODY:
            raise ApiError(413, "Request too large.")
        raw = self.rfile.read(n) if n else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            raise ApiError(400, "Body must be JSON.")
        if not isinstance(data, dict):
            raise ApiError(400, "Body must be a JSON object.")
        return data

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True, "service": "JARVIS Desktop Agent", "version": VERSION})
            return
        if self.path == "/api/status":
            if not self._authed():
                self._json(401, {"ok": False, "error": "Unauthorized"})
                return
            self._json(200, {
                "ok": True, "service": "JARVIS Desktop Agent", "version": VERSION,
                "uptime_seconds": round(time.time() - self.server.started),
                "capabilities": ["health", "status", "fs.list", "fs.read", "fs.write", "fs.put", "clip", "run"],
                "execution_enabled": True, "workspace": self.server.root
            })
            return
        self._json(404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        if not self._authed():
            self._json(401, {"ok": False, "error": "Unauthorized"})
            return
        try:
            data = self._body()
            root = self.server.root
            if self.path == "/fs/list":
                out = do_list(root, data.get("path", ""))
            elif self.path == "/fs/read":
                out = do_read(root, data.get("path", ""), data.get("max_bytes"))
            elif self.path == "/fs/write":
                out = do_write(root, data.get("path", ""), data.get("content"))
            elif self.path == "/fs/put":
                out = do_put(root, data.get("path", ""), data.get("url"), data.get("contentType"))
            elif self.path.startswith("/clip/"):
                import clipper
                try:
                    if self.path == "/clip/search":
                        out = {"ok": True, "results": clipper.search(data.get("query"), data.get("n", 8), bool(data.get("cc")))}
                    elif self.path == "/clip/fetch":
                        out = dict(clipper.fetch(root, data.get("url")), ok=True)
                    elif self.path == "/clip/cut":
                        out = dict(clipper.cut(root, data.get("source", ""), data.get("segments"), data.get("vertical"), resolve_in_workspace), ok=True)
                    else:
                        raise ApiError(404, "Not found")
                except clipper.ClipError as e:
                    raise ApiError(400, str(e))
            elif self.path == "/run":
                out = do_run(root, data.get("command"), data.get("cwd", ""), data.get("timeout"))
            else:
                raise ApiError(404, "Not found")
            self._json(200, out)
        except ApiError as e:
            self._json(e.status, {"ok": False, "error": e.message})
        except Exception as e:                       # never let one bad call kill the agent
            self._json(500, {"ok": False, "error": "Agent error: %s" % e})

    def log_message(self, fmt, *args):
        print("[agent] " + (fmt % args))


def make_server(host=HOST, port=PORT, root=DEFAULT_WORKSPACE, token=None, origins=None):
    os.makedirs(root, exist_ok=True)
    srv = ThreadingHTTPServer((host, port), Handler)
    srv.root = os.path.realpath(root)
    srv.token = token or secrets.token_urlsafe(32)
    srv.origins = list(origins if origins is not None else DEFAULT_ORIGINS)
    srv.started = time.time()
    return srv


def main(argv=None):
    ap = argparse.ArgumentParser(description="JARVIS desktop agent")
    ap.add_argument("--workspace", default=os.environ.get("JARVIS_WORKSPACE", DEFAULT_WORKSPACE),
                    help="the only folder file calls may touch, and where commands start")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--origin", action="append", default=None,
                    help="extra web page address allowed to call the agent (repeatable)")
    args = ap.parse_args(argv)
    origins = DEFAULT_ORIGINS + (args.origin or [])
    srv = make_server(HOST, args.port, args.workspace, None, origins)
    print("\nJARVIS Desktop Agent v%s" % VERSION)
    print("Listening only on http://%s:%d" % (HOST, args.port))
    print("Workspace (files are confined here): %s" % srv.root)
    print("Allowed pages: %s" % ", ".join(origins))
    print("Temporary dashboard token (keep private, it works like a password):\n%s\n" % srv.token)
    print("Commands run with YOUR permissions. Approve each one in the Jarvis page.\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nJARVIS Desktop Agent stopped.")


if __name__ == "__main__":
    main()
