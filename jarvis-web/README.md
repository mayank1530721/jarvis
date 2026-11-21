# Jarvis (web version)

A personal AI assistant that runs in your browser. No install, no Python.

## What it does today
- Chat, with the last conversations remembered. A live particle sphere shows when Jarvis is listening, thinking or speaking, with panels for system status, timers, memory and activity.
- Talk to it with the Mic button; it talks back (use Chrome or Edge).
- Long-term memory: say "remember that I ..." and it saves it. See and edit it under Memory.
- Tools: tell the time, open websites, search Google, set timers.

## Use it
1. Get a free Gemini key at aistudio.google.com (or use any OpenAI-compatible provider).
2. Open the page, click Settings, paste the key, Save.
3. Everything (key, memory, chat) is stored only in your own browser.

To switch AI provider later, change the model, API base URL and backup models in Settings. Any OpenAI-compatible service works. If the main model is busy (503), Jarvis retries, then tries the backup models in order.

## Host it free (GitHub Pages)
Repo Settings > Pages > Deploy from a branch > `main` and folder `/ (root)`. Then open
`https://<your-username>.github.io/jarvis/jarvis-web/`.

## Not possible from a web page (later stage)
Controlling your computer (opening apps, files) and a hands-free "Hey Jarvis" wake word need a small helper program on your PC. That comes later.

## Run offline with a local model (Ollama)
1. Install Ollama from ollama.com and pull a small model (see ollama.com/search?c=tools for ones that support tools).
2. Let the Jarvis page talk to Ollama: set the environment variable `OLLAMA_ORIGINS` to `https://<your-username>.github.io`, then restart Ollama.
3. In Jarvis, open Settings, press "Use local model (Ollama, works offline)", type the model name, and Save.
4. The page itself is saved by your browser after the first visit, so it also opens without internet.

Notes: the Mic button uses Chrome's speech recognition, which needs internet. Fully offline listening needs a speech model in the browser (planned). Speaking replies aloud works offline if your system has an installed voice.
