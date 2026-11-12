# Jarvis for ClipCore (stage one)

A Telegram bot that writes YouTube titles and descriptions that follow a campaign's rules, and waits for your approval.

## What it does today
- You paste a campaign's rules with `/rules`.
- You describe a clip with `/clip`.
- It drafts a title, description and tags, and you tap Approve or Redo.
- Only your Telegram account can use it.

## What it does not do yet
- It does not publish. `publisher.py` is a placeholder until there is an official way to publish (an Uplika API key or YouTube's upload API).
- It does not browse Content Rewards, control Miniclips, or take phone calls. Those are later stages.

## Setup (one time)
1. In Telegram, message **@BotFather**, send `/newbot`, and copy the token it gives you.
2. In Telegram, message **@userinfobot** and copy your numeric ID.
3. Get an API key from the Anthropic Console.
4. Copy `.env.example` to `.env` and paste the three values in.

## Run it
```
pip install -r requirements.txt
python bot.py
```
To keep it running all day without your laptop, deploy this folder to a small cloud host (Railway, Render or Fly.io) and set the same three values as environment variables there.
