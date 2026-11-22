# JARVIS Desktop Agent

The local "hands" for ULTRON. It uses only Python's standard library.

## Requirements
- Windows 10/11 (also works on macOS and Linux)
- Python 3.10+ (no extra packages)

## Run
1. Open PowerShell.
2. Enter the `desktop-agent` folder.
3. Run `py agent.py`. To pick the folder ULTRON may work in, run `py agent.py --workspace C:\path\to\folder`.
   With no option it uses a folder called `jarvis-workspace` in your home folder (created for you).
4. Copy the temporary token it prints, open Jarvis, Settings, and paste it into "Desktop agent token". Save.
5. Keep the window open while ULTRON works. The token changes every time the agent restarts.

To let ULTRON work on Jarvis itself, make the workspace a copy (clone) of your jarvis repository. Commit before
big tasks so you can undo anything.

## What ULTRON can do through it
- List and read files inside the workspace folder.
- Write files inside the workspace folder (you approve each one and see what changes).
- Run shell commands, starting in the workspace (you approve each one). Output is returned to ULTRON so he can
  fix errors and run again. Commands cannot take keyboard input and are stopped after their timeout (60 seconds
  by default, 10 minutes at most).

## Safety boundary
- It listens only on this computer (127.0.0.1), needs the token for everything except `/health`, and only accepts
  calls from the Jarvis page address it was started with. Add another address with `--origin https://example.com`.
- **File calls are confined to the workspace folder**, including through shortcuts (symbolic links). There is no
  delete call.
- **Commands are not confined.** A command runs with your own permissions and can read or change anything you can.
  That is why Jarvis asks you to approve every command, and why "Allow for this task" should only be used when you
  trust what you asked for. A short blocklist refuses a few machine-wide disasters (formatting a drive,
  `rm -rf /`, shutdown). It is a speed bump, not a sandbox.
- A model can make mistakes or be steered by text it reads in files. Read the command before approving it.
- Python bytecode caching is switched off for commands it runs, so an edited file is always the version that runs.

## Tests
`python3 tests/test_agent.py` from the repository root.
