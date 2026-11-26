# Jarvis for ClipCore

> **The main app is now `jarvis-web/`**: a browser-based JARVIS with specialist agents (see `jarvis-web/README.md`). This page describes the older Telegram bot that writes YouTube titles for campaigns. `desktop-agent/` is an early, read-only helper for controlling your PC later.

A Telegram bot that writes YouTube titles and descriptions that follow a campaign's rules, and waits for your approval. Everything it uses has a free tier, so it costs nothing to run at this size.

## What it does today
- `/rules <text>` saves a campaign's rules.
- `/clip <text>` or a **voice note** describes a clip.
- It drafts a title, description and tags, and you tap Approve or Redo.
- Only your Telegram account can use it.

## What it does not do yet
- Publishing: with `UPLIKA_API_KEY` in `.env`, pressing Approve sends the title and description to your Uplika channels (optionally limited by `UPLIKA_ACCOUNT_IDS`). It sends text only, so channels that require a video (YouTube Shorts, Reels) are refused by Uplika and still need the video attached in Uplika. Without the key it just tells you to copy the text.
- It does not browse Content Rewards or control Miniclips. Those are later stages.
- It cannot phone you. Phone calls generally need a paid phone service, so they are left out to keep this free. Voice notes in Telegram are the free replacement.

## Free services it uses
| Job | Service | Where to get a key |
|---|---|---|
| Writing the drafts | Google Gemini API free tier | aistudio.google.com |
| Understanding voice notes (optional) | Groq free tier | console.groq.com |
| Chat app | Telegram | @BotFather |

Free tiers have daily and per-minute limits and can change. If the bot says it hit a limit, wait and try again. Google shows your exact limits at aistudio.google.com/rate-limit.

## Setup
1. In Telegram, message **@BotFather**, send `/newbot`, copy the token.
2. In Telegram, message **@userinfobot**, copy your numeric ID.
3. Get a Gemini key from Google AI Studio.
4. Optional, for voice notes: get a Groq key.
5. Copy `.env.example` to `.env` and fill in the values. The bot reads this file automatically.

## Run it free on your own computer
```
pip install -r requirements.txt
python bot.py
```
The bot works only while the computer is on and this window is open.

## Run it free in the cloud
Free hosts change their rules often, so check the current terms before signing up. Fly.io asks for a credit card. Render's free web service goes to sleep when idle, which works with this bot: set `WEBHOOK_URL` to your Render address and Telegram wakes it when you message it. Expect the first reply after a quiet spell to be slow.

On the host, set the same values from `.env.example` as environment variables, use `pip install -r requirements.txt` to build and `python bot.py` to start.

## Clips to posts (FRIDAY)
Miniclips is a window-only Windows app and has no command line, API or watch folder that I could find, so the agents cannot click inside it. You do that one step: make clips in Miniclips and export them into the `clips` folder of the desktop agent's workspace. From there:
- FRIDAY lists the clips (`clips_list`), writes a caption and YouTube title for each to the campaign rules you give her, and posts with `uplika_publish_video`.
- The post dialog shows the file, caption and channels. Nothing is uploaded or posted until you approve.
- The video never passes through the browser: Jarvis asks Uplika for an upload address, the desktop agent sends the file to it (`/fs/put`, mp4/mov/webm only, https only), then Jarvis completes the upload and posts.
- Needs the Uplika key and the desktop agent token. Only post clips you have the right to post, such as ones from campaigns that allow it.

## Clip desk (VISION and ULTRON)
Ask VISION (or ULTRON) for clips and he runs the pipeline on your computer through the desktop agent: search YouTube (no key; Creative Commons filter available), download one video with its captions, pick the best moments from the transcript, and cut them (optionally vertical 9:16) into `clips/`. Then ask FRIDAY to caption and post them.
- Needs `yt-dlp` and `ffmpeg` installed (Windows: `winget install yt-dlp.yt-dlp` and `winget install Gyan.FFmpeg`), and the desktop agent token in Settings.
- Every download and cut asks for your approval. Every post asks for your approval.
- He works from the video's captions, not by watching it. Videos with no captions can't be judged yet (no speech-to-text fallback is built).
- Only use sources you may clip: campaign sources, your own videos, Creative Commons.

## Switching inside a private chat
In a Black Vault private chat a "Switch to FRIDAY / JARVIS" button appears in the header. Each of them keeps their own private conversation for the session; nothing goes to normal history. Ending the chat saves one encrypted summary per agent you actually talked to.
