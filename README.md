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
