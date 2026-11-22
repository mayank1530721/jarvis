"""Run with: python3 tests/test_publisher.py"""
import asyncio, json, os, sys
import httpx
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("GEMINI_API_KEY", "x")
import publisher

passed = 0
def check(name, cond):
    global passed
    print(("PASS " if cond else "FAIL ") + name); passed += bool(cond)
    if not cond: sys.exit(1)

def run(handler, key="K", ids=""):
    seen = []
    def wrapped(req):
        seen.append(req); return handler(req)
    publisher._transport = httpx.MockTransport(wrapped)
    os.environ["UPLIKA_API_KEY"] = key; os.environ["UPLIKA_ACCOUNT_IDS"] = ids
    try: return asyncio.run(publisher.publish_clip("T", "D", ["a"])), seen
    except publisher.PublishError as e: return e, seen

ok = lambda req: httpx.Response(200, json={"data": [{"id": "a1", "status": "active"}, {"id": "a2", "status": "revoked"}]}) if req.method == "GET" else httpx.Response(200, json={"id": "p"})
msg, seen = run(ok)
post = [r for r in seen if r.method == "POST"][0]
check("posts to every active channel only", json.loads(post.content) == {"content": "T\n\nD", "accountIds": ["a1"]})
check("sends the key as a bearer token", all(r.headers["authorization"] == "Bearer K" for r in seen))
msg, seen = run(ok, ids="x1, x2")
check("explicit channel ids skip the account lookup", [r.method for r in seen] == ["POST"] and json.loads(seen[0].content)["accountIds"] == ["x1", "x2"])
msg, seen = run(ok, key="")
check("no key: nothing is sent, gives manual instructions", seen == [] and "not connected" in msg)
msg, _ = run(lambda r: httpx.Response(401, json={}))
check("bad key is explained", isinstance(msg, publisher.PublishError) and "UPLIKA_API_KEY" in str(msg))
msg, _ = run(lambda r: httpx.Response(200, json={"data": []}))
check("no channels is explained", isinstance(msg, publisher.PublishError) and "No connected channels" in str(msg))
msg, _ = run(lambda r: httpx.Response(422, json={"message": "media required"}) if r.method == "POST" else httpx.Response(200, json={"data": [{"id": "a1"}]}))
check("a channel that needs video gives Uplika's reason", isinstance(msg, publisher.PublishError) and "media required" in str(msg))
def boom(r): raise httpx.ConnectError("down")
msg, _ = run(boom)
check("network failure is explained", isinstance(msg, publisher.PublishError) and "Could not reach" in str(msg))

import copywriter
def gem(text): return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": text}]}}]})
for label, text in [("plain", '{"title":"t","description":"d","tags":["x"]}'), ("fenced", '```json\n{"title":"t","description":"d","tags":["x"]}\n```'), ("bare fence", '```\n{"title":"t","description":"d"}\n```')]:
    copywriter.httpx.post = lambda *a, _t=text, **k: gem(_t)
    try: d = copywriter.write_metadata("rules", "notes")
    except Exception as e: d = e
    check("copywriter reads " + label + " JSON", isinstance(d, dict) and d["title"] == "t")
print("%d checks passed" % passed)
