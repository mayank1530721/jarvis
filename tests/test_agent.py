import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-agent"))
import agent  # noqa: E402

ORIGIN = "https://mayank1530721.github.io"


class AgentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = os.path.join(cls.tmp.name, "ws")
        cls.srv = agent.make_server("127.0.0.1", 0, cls.root, token="testtoken", origins=[ORIGIN])
        cls.port = cls.srv.server_address[1]
        cls.thread = threading.Thread(target=cls.srv.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        cls.tmp.cleanup()

    def call(self, path, body=None, token="testtoken", method=None, origin=None):
        url = "http://127.0.0.1:%d%s" % (self.port, path)
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method or ("POST" if body is not None else "GET"))
        if token:
            req.add_header("Authorization", "Bearer " + token)
        if origin:
            req.add_header("Origin", origin)
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, json.loads(r.read().decode()), r.headers
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode()), e.headers

    def test_health_is_open_status_needs_token(self):
        self.assertEqual(self.call("/health", token=None)[0], 200)
        self.assertEqual(self.call("/api/status", token=None)[0], 401)
        s, body, _ = self.call("/api/status")
        self.assertEqual(s, 200)
        self.assertTrue(body["execution_enabled"])
        self.assertIn("run", body["capabilities"])

    def test_post_requires_token(self):
        self.assertEqual(self.call("/fs/list", {"path": ""}, token=None)[0], 401)
        self.assertEqual(self.call("/run", {"command": "echo hi"}, token="wrong")[0], 401)

    def test_write_read_list_roundtrip(self):
        s, body, _ = self.call("/fs/write", {"path": "proj/hello.txt", "content": "héllo\nworld"})
        self.assertEqual(s, 200)
        self.assertTrue(body["created"])
        s, body, _ = self.call("/fs/read", {"path": "proj/hello.txt"})
        self.assertEqual(body["content"], "héllo\nworld")
        self.assertFalse(body["truncated"])
        s, body, _ = self.call("/fs/list", {"path": "proj"})
        self.assertEqual([e["name"] for e in body["entries"]], ["hello.txt"])
        s, body, _ = self.call("/fs/write", {"path": "proj/hello.txt", "content": "again"})
        self.assertFalse(body["created"])

    def test_paths_cannot_escape_workspace(self):
        for bad in ["../outside.txt", "a/../../outside.txt", "/etc/passwd", "C:/Windows/win.ini", "..\\x"]:
            s, body, _ = self.call("/fs/write", {"path": bad, "content": "x"})
            self.assertEqual(s, 400, bad)
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, "outside.txt")))
        self.assertEqual(self.call("/fs/read", {"path": "../../etc/passwd"})[0], 400)

    @unittest.skipIf(os.name == "nt", "symlinks need privileges on Windows")
    def test_symlink_escape_is_blocked(self):
        outside = os.path.join(self.tmp.name, "secret.txt")
        with open(outside, "w") as f:
            f.write("secret")
        os.symlink(self.tmp.name, os.path.join(self.root, "link"))
        self.assertEqual(self.call("/fs/read", {"path": "link/secret.txt"})[0], 400)
        self.assertEqual(self.call("/fs/write", {"path": "link/new.txt", "content": "x"})[0], 400)

    def test_binary_file_is_not_read(self):
        with open(os.path.join(self.root, "bin.dat"), "wb") as f:
            f.write(b"abc\x00def")
        self.assertEqual(self.call("/fs/read", {"path": "bin.dat"})[0], 415)

    def test_large_read_is_truncated(self):
        with open(os.path.join(self.root, "big.txt"), "w") as f:
            f.write("a" * (agent.MAX_READ + 500))
        s, body, _ = self.call("/fs/read", {"path": "big.txt"})
        self.assertTrue(body["truncated"])
        self.assertEqual(len(body["content"]), agent.MAX_READ)

    def test_run_captures_output_and_exit_code(self):
        s, body, _ = self.call("/run", {"command": "echo hello && echo oops 1>&2 && exit 3"})
        self.assertEqual(s, 200)
        self.assertEqual(body["exit_code"], 3)
        self.assertIn("hello", body["output"])
        self.assertIn("oops", body["output"])

    def test_run_starts_in_workspace_and_respects_cwd(self):
        os.makedirs(os.path.join(self.root, "sub"), exist_ok=True)
        cmd = "cd" if os.name == "nt" else "pwd"
        s, body, _ = self.call("/run", {"command": cmd, "cwd": "sub"})
        self.assertTrue(body["output"].strip().endswith("sub"))
        self.assertEqual(self.call("/run", {"command": cmd, "cwd": ".."})[0], 400)

    def test_edit_and_rerun_uses_the_new_code(self):
        # Same size, same second: Python's bytecode cache used to serve the old code here.
        py = "python" if os.name == "nt" else "python3"
        check = '%s -c "from stale import f; print(f())"' % py
        self.call("/fs/write", {"path": "fix/stale.py", "content": "def f():\n    return 'OLD'\n"})
        s, body, _ = self.call("/run", {"command": check, "cwd": "fix"})
        self.assertIn("OLD", body["output"])
        self.call("/fs/write", {"path": "fix/stale.py", "content": "def f():\n    return 'NEW'\n"})
        s, body, _ = self.call("/run", {"command": check, "cwd": "fix"})
        self.assertIn("NEW", body["output"])
        self.assertFalse(os.path.exists(os.path.join(self.root, "fix", "__pycache__")))

    def test_run_times_out_and_kills(self):
        cmd = "ping -n 30 127.0.0.1" if os.name == "nt" else "sleep 30"
        s, body, _ = self.call("/run", {"command": cmd, "timeout": 1})
        self.assertEqual(s, 200)
        self.assertTrue(body["timed_out"])
        self.assertIsNone(body["exit_code"])
        self.assertLess(body["seconds"], 10)

    def test_run_output_is_clipped_to_the_end(self):
        n = agent.MAX_OUTPUT + 5000
        cmd = 'python3 -c "print(\'x\'*%d); print(\'THE-END\')"' % n
        if os.name == "nt":
            cmd = cmd.replace("python3", "python")
        s, body, _ = self.call("/run", {"command": cmd})
        self.assertTrue(body["clipped"])
        self.assertIn("THE-END", body["output"])

    def test_blocklist(self):
        for cmd in ["rm -rf /", "rm -rf ~", "rm -fr /*", "sudo mkfs.ext4 /dev/sda1", "format c:", "shutdown now",
                    "dd if=/dev/zero of=/dev/sda", ":(){ :|:& };:"]:
            self.assertIsNotNone(agent.blocked_reason(cmd), cmd)
            self.assertEqual(self.call("/run", {"command": cmd})[0], 403, cmd)
        for ok in ["rm -rf build", "rm -rf node_modules", "npm test", "python main.py", "echo format c"]:
            self.assertIsNone(agent.blocked_reason(ok), ok)

    def test_cors_only_for_allowed_origin(self):
        _, _, h = self.call("/health", token=None, origin=ORIGIN)
        self.assertEqual(h.get("Access-Control-Allow-Origin"), ORIGIN)
        self.assertIn("POST", h.get("Access-Control-Allow-Methods", ""))
        _, _, h = self.call("/health", token=None, origin="https://evil.example")
        self.assertIsNone(h.get("Access-Control-Allow-Origin"))

    def test_bad_json_and_unknown_route(self):
        req = urllib.request.Request("http://127.0.0.1:%d/run" % self.port, data=b"not json", method="POST")
        req.add_header("Authorization", "Bearer testtoken")
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(req, timeout=10)
        self.assertEqual(cm.exception.code, 400)
        self.assertEqual(self.call("/nope", {})[0], 404)


if __name__ == "__main__":
    unittest.main()
