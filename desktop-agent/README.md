# JARVIS Desktop Agent

The first local-agent foundation. It uses only Python's standard library and is
intentionally read-only.

## Requirements
- Windows 10/11
- Python 3.10+ (no extra packages)

## Run
1. Open PowerShell.
2. Enter the `desktop-agent` folder.
3. Run `py agent.py`.
4. Keep the window open while testing.
5. Open `http://127.0.0.1:8765/health` in your browser. It should return
   JSON with `"ok": true`.

The agent prints a temporary bearer token at startup. Treat it like a password.
It changes each time the agent restarts.

## Safety boundary
Version 0.1 only exposes health and authenticated status endpoints. It does
not execute shell commands, access files, install itself as a background
service, or monitor folders. Those capabilities will be added individually
with explicit permissions and visible approval.
