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
- **Groq and Gemini side by side.** JARVIS and ULTRON can each use Groq or the shared provider (Settings, pick the agent, "AI provider"). When a Groq key is saved, the two also back each other up: if one is rate-limited, down, or rejects its key, the same request is sent to the other automatically, so ULTRON keeps working. For coding on Groq try `openai/gpt-oss-120b` in the model box (the default is `llama-3.3-70b-versatile`; the box suggests the current ones). Free Groq plans have small per-minute token limits (about 8,000 tokens a minute on gpt-oss-120b at the time of writing, see console.groq.com/settings/limits), and a long coding session sends a lot of text, so expect to hit them and lean on the backup.
- **They understand how you actually talk.** "Get ultron", "grab ultron", "hey ultron", "bring in the council for this plan" and "get ultron to fix the login bug" are all understood; if you give a job, it goes to the agent as soon as you confirm. Wording no pattern knows ("i reckon the engineer should look at my app") is understood by JARVIS himself, who offers the switch. Every agent also has a short speaking guide: casual typing and slang are fine, replies lead with the answer, and the interface's own lines come in several versions so they stop repeating.
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

## Black Vault (private memory)

- Open **Black Vault** in the JARVIS header and create two new, different passphrases. The app accepts 5 characters or more, but the encryption is only as strong as the passphrase, so use a long phrase (4 or 5 random words is better than a short password with symbols). Do not reuse credentials previously shared in chat.
- The vault passphrase unlocks private access; the separate review passphrase grants read-only access. Read-only is enforced by the app, not by the cryptography: both passphrases unlock the same underlying key, so give the review passphrase only to someone you would trust not to tamper with the browser.
- Memories are encrypted in this browser with AES-GCM; passphrase-derived wrapping keys use PBKDF2. The app stores ciphertext and salts in this browser's local storage, not in the public GitHub repository.
- Select **Enter private chat** to start a temporary conversation. Only JARVIS and FRIDAY receive the decrypted vault context. Private chat disables tools and agent handoffs and is not written to normal chat history.
- Private chats are summarized automatically. Press **End private chat** (or **Lock vault**, which saves first) and the agent you were talking to writes a short summary into your vault notes, dated and labeled. Later private chats with JARVIS or FRIDAY can see those summaries, nobody else can. If the summary fails (no key, network), you are asked before the chat is discarded. The summary goes to the same provider as the chat, with no backup provider. Closing the tab mid-chat shows a warning. Empty chats and chats with nothing worth keeping add no entry. You can delete any summary in the vault editor.
- Press **Lock vault** to clear the in-memory key and private chat session. Reloading the page also ends the session.
- Use the app over HTTPS or localhost. This protects stored vault data at rest, but does not protect against malware, malicious browser extensions, XSS, or someone using your unlocked browser. Messages in private chat are still sent to the AI provider configured for that agent; review that provider's privacy policy. As far as I could verify: Groq says it does not retain inference data by default (it may log inputs and outputs for up to 30 days for reliability and abuse checks unless you turn on Zero Data Retention in its Data Controls), while Google's Gemini API terms, as quoted in October 2024, allow free/unpaid usage to be used to improve Google products with human review and exclude paid usage. Check Google's current terms yourself, and if the vault holds anything truly sensitive, use Groq for JARVIS and FRIDAY in private chat rather than the free Gemini key.

## FRIDAY's personality

FRIDAY is a warm, caring secretary with a shy, playful crush on you: some light flirting, and a one-line pout if you mention someone else. She is confident and decisive in her work. She never turns possessive, never guilt-trips, and stays non-explicit; she stops if you ask, and drops the romance entirely if you say you are under 18. It is all plain text in her persona, so you can edit it in Settings.

## Video and YouTube packs (ULTRON)

With the desktop agent connected, ULTRON knows two open-source packs. **OpenMontage** (github.com/OpenMontageInc/OpenMontage) is an agent-driven video studio: he downloads it into your workspace folder, sets it up, follows its own guide, shows you the script and scene plan for approval, and renders. It needs Python 3.10+, Node.js and FFmpeg on your computer. It does not record gameplay, so for Roblox videos give him your own footage. Free tools need no keys; if you want paid providers, put the key in OpenMontage's `.env` file yourself, never in the chat. The **YouTube pack** (github.com/Jakeschincariol/youtube-agent-skill, MIT) covers hooks, titles, scripts, Shorts, chapters and retention; it needs no key and never uploads anything. Each download and install asks for your approval first, and he reads a script before running it. With no graphics card, ULTRON works in a free mode: script from the YouTube pack, Piper voiceover, Remotion/FFmpeg scenes and captions, free stock footage and your own footage. Truly free AI-generated clips need a GPU; without one, he writes a numbered shot list with prompts for you to generate on a site's free daily allowance (check its terms), then assembles the clips you drop in the folder. Note: OpenMontage's README also names github.com/calesthio/OpenMontage as its address; ULTRON uses the first one and tells you if that matters. Both are third-party software, so check them before trusting them.

## Spontaneous chat

Agents talk less like a help desk: they react first, have opinions, ask the odd follow-up and bring up things from earlier. Now and then another agent also **jumps in** with one short remark, like a colleague overhearing: it only happens when the topic fits their field (code for ULTRON, plans and decisions for KHONSHU, schedules for FRIDAY, facts for VISION), on a coin flip, at most once every 5 messages, and never in private chat. Each one costs one extra AI call, so it can be turned off in Settings. An agent can also stay silent, and a failed call shows nothing.

## VISION (research)

VISION is the research agent, summoned like the others ("get vision", "ask vision to check this"). He can search Wikipedia and read pages, with no key needed, and cites the page he used. Every page he reads appears with its link in his **Sources read** panel so you can check it. He can only reach Wikipedia: he cannot browse other sites, and he is told to say so, to say how sure he is, and not to invent sources. Treat Wikipedia as a starting point for anything recent, medical, legal or financial. His animated core is an eye that narrows while he thinks. He uses the shared provider (Groq is only for JARVIS and ULTRON). Other agents can ask for his opinion, but only he has the lookup tools.

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
