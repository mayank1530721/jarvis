# Jarvis (web version)

A personal AI assistant that runs in your browser. No install, no Python, no build step.

It is a small ecosystem: **JARVIS** is the command centre, and specialist agents sit behind it.

| Agent | Role | Status |
|---|---|---|
| JARVIS | Central intelligence, command centre | Live |
| ULTRON | Software engineering | Live (writes code; with the desktop agent it can also edit files and run commands you approve) |
| FRIDAY | Operations and social media | Planned |
| KHONSHU | Strategy council (Steven, Marc, Jake). Formerly DAREDEVIL | Live (advice only; writes no code) |
| VISION | Research | Planned |

## What it does today
- **Switch agents.** Say or type "Unleash ULTRON". JARVIS asks "Boss, are you certain you wish to release ULTRON?", you confirm (type yes, or press the button), the screen changes to ULTRON's crimson workspace and ULTRON takes over. Say "stand down" to return to JARVIS. Switching is scripted, so it is instant, free and works without an API key.
- **Each agent is separate.** Own personality, own voice, own chat history, own colours and workspace layout. They share one memory ("Second Brain" v0).
- **JARVIS** shows the whole ecosystem: which agents exist, which is active, how much each has been used, plus timers, memory and activity.
- **KHONSHU** presides over a three-lens council: Steven (CFO: money, hidden costs), Marc (mercenary: feasibility, what breaks first) and Jake (realist: will anyone actually want it). Say "Unleash Khonshu" ("Convene the council" and "Unleash Daredevil" still work). He talks like a person: he answers what you said, asks the one question that matters, concedes a point when you answer it well, and brings Steven, Marc or Jake in only when their angle matters. He gives the formal ruling (VERDICT approved, conditional or rejected, conditions, risk register, cheapest next test, shown in side panels) only when you ask for a decision or the discussion has converged, and it needs all three to agree. The verdict block is shown on screen, not read aloud. Your old DAREDEVIL chat and model settings were carried over; his saved personality was not, so he picks up the new default.
- **Per-agent models.** In Settings, each agent can use the shared provider or select Groq independently. Add a Groq API key once; JARVIS and ULTRON can then use Groq with a model such as `llama-3.3-70b-versatile`. Each agent can also have its own model, base URL and key (for example KHONSHU on a local Ollama model). A custom endpoint never receives the shared key.
- **Uplika (social posting).** Paste an Uplika API key in Settings (create one under API Keys in the Uplika dashboard) and JARVIS can list your connected channels and draft posts. Every post opens an approval box showing the text and channels; nothing goes out until you press Post now, and you can edit the text first. The key stays in your browser and is sent only to api.uplika.com. Only JARVIS has this for now; FRIDAY will own it once built. If your browser blocks the call (CORS), deploy the free relay in `uplika-relay/worker.js` on Cloudflare Workers (dash.cloudflare.com > Workers & Pages > Create > Hello World > Edit code > paste the file > Deploy) and paste its address into "Uplika relay address" in Settings.
- **GitHub for ULTRON.** Paste a GitHub token in Settings and ULTRON can list your repositories, read files, and propose changes. Create the token at github.com > Settings > Developer settings > Personal access tokens > Fine-grained tokens: pick only the repositories you want ULTRON to see, and give it Contents: read and write and Pull requests: read and write. Every change shows you exactly which files will be edited or added, and only after you press the button does ULTRON create a new `ultron/...` branch and open a pull request. It never writes to your main branch and never merges. The token stays in your browser and is sent only to api.github.com.
- **Agents talk to each other.** Any available agent can ask another one for their view (ULTRON asks KHONSHU to challenge a design, KHONSHU asks ULTRON whether something is feasible, JARVIS asks both). You see every question and answer in the chat. The asked agent answers in its own voice with no tools and cannot ask anyone else, so it cannot loop. Limit: 3 questions per request, because each is an extra model call and free tiers have rate limits. To have two agents react to each other, ask JARVIS (or either agent) to "get ULTRON's view, then have KHONSHU respond to it".
- **ULTRON's hands (desktop agent).** Run `desktop-agent/agent.py` on your computer, paste the token it prints into Settings ("Desktop agent token"), and ULTRON can list and read files in one workspace folder, write files (you see a diff and approve), and run commands (you see the command and approve). "Allow for this task" approves the rest of that one request so ULTRON can loop write, run, read the error, fix, run again (up to 30 steps) without asking every time; the next request asks again. Everything he does is listed in the chat. See `desktop-agent/README.md` for the safety limits, which you should read before using it.
- **ULTRON** has a Projects panel (give it the stack and goals for what you are building; it reads the active project's notes in every reply) and a Code blocks panel that collects the code it writes, each with a Copy button.
- Chat with streamed replies, voice in (Mic button) and voice out, long-term memory ("remember that..."), and tools: time, open a website, search Google, timers.
- Each agent's voice and personality can be changed in Settings.

## Use it
1. Get a free Gemini key at aistudio.google.com (or use any OpenAI-compatible provider).
2. Open the page, click Settings, paste the key, Save.
3. Everything (key, memory, chats, projects) is stored only in your own browser.

To switch AI provider later, change the model, API base URL and backup models in Settings. If the main model is busy, Jarvis retries, then tries the backup models in order.

## Voices
A web page can only use the voices installed on your computer, so "deep male" is a best effort: Jarvis prefers a British male voice and ULTRON a deeper US male voice, and you can pick any installed voice by hand in Settings. On Windows 11, Edge has the best free voices ("Natural" ones); install more under Settings > Time & language > Speech.

## How the code is laid out
```
index.html        the page (markup only)
css/theme.css     colours for each agent (one block per agent)
css/app.css       layout and components, reads the colours above
js/agents.js      the agent registry: personas, voices, wording. Add or edit an agent here.
js/github.js      GitHub connection for ULTRON (read, plan, branch + PR)
js/uplika.js      Uplika connection (accounts, publish)
js/council.js     reads KHONSHU's verdict, risks and lens lines
js/intent.js      understands "Unleash ULTRON", yes/no, "stand down"
js/voice.js       picks a voice for each agent, speaks
js/model.js       talks to the AI (streaming, retries, backups, tool calls)
js/cores.js       the animated core drawn for each agent
js/app.js         the screen, chat loop and agent switching
sw.js             keeps the page available offline
tests/            checks for the plain-logic parts
```
To check the logic parts (needs Node.js): `node jarvis-web/tests/logic.test.js`.

## Host it free (GitHub Pages)
Repo Settings > Pages > Deploy from a branch > `main` and folder `/ (root)`. Then open
`https://<your-username>.github.io/jarvis/jarvis-web/`.

## Not possible from a web page (later stage)
Controlling your computer (opening apps, files, running code) and a hands-free "Hey Jarvis" wake word need a small helper program on your PC (see `desktop-agent/`, not connected yet). FRIDAY posting to social media and VISION browsing the web also need services this page cannot reach on its own.

## Run offline with a local model (Ollama)
1. Install Ollama from ollama.com and pull a small model (see ollama.com/search?c=tools for ones that support tools).
2. Let the Jarvis page talk to Ollama: set the environment variable `OLLAMA_ORIGINS` to `https://<your-username>.github.io`, then restart Ollama.
3. In Jarvis, open Settings, press "Use local model (Ollama, works offline)", type the model name, and Save.
4. The page itself is saved by your browser after the first visit, so it also opens without internet.

Notes: the Mic button uses Chrome's speech recognition, which needs internet. Speaking replies aloud works offline if your system has an installed voice.
