# Jarvis (web version)

A personal AI assistant that runs in your browser. No install, no Python.

## What it does today
- Chat, with the last conversations remembered.
- Talk to it with the Mic button; it talks back (use Chrome or Edge).
- Long-term memory: say "remember that I ..." and it saves it. See and edit it under Memory.
- Tools: tell the time, open websites, search Google, set timers.

## Use it
1. Get a free Gemini key at aistudio.google.com (or use any OpenAI-compatible provider).
2. Open the page, click Settings, paste the key, Save.
3. Everything (key, memory, chat) is stored only in your own browser.

To switch AI provider later, change the model and API base URL in Settings. Any OpenAI-compatible service works.

## Host it free (GitHub Pages)
Repo Settings > Pages > Deploy from a branch > `main` and folder `/ (root)`. Then open
`https://<your-username>.github.io/jarvis/jarvis-web/`.

## Not possible from a web page (later stage)
Controlling your computer (opening apps, files) and a hands-free "Hey Jarvis" wake word need a small helper program on your PC. That comes later.
