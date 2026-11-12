"""Writes a YouTube title, description and tags that follow a campaign's rules."""
import json
import os

import anthropic

MODEL = "claude-sonnet-5-5"

SYSTEM = (
    "You write metadata for YouTube Shorts. Follow the campaign rules exactly: "
    "required hashtags, mentions, disclosures, banned words, length limits. "
    "Never invent facts about the clip. Reply with JSON only, in this shape: "
    '{"title": str, "description": str, "tags": [str]}. '
    "Title max 100 characters."
)


def write_metadata(campaign_rules: str, clip_notes: str) -> dict:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    reply = client.messages.create(
        model=MODEL,
        max_tokens=800,
        system=SYSTEM,
        messages=[
            {
                "role": "user",
                "content": f"CAMPAIGN RULES:\n{campaign_rules}\n\nABOUT THE CLIP:\n{clip_notes}",
            }
        ],
    )
    text = reply.content[0].text.strip()
    start, end = text.find("{"), text.rfind("}")
    data = json.loads(text[start : end + 1])
    data["title"] = data["title"][:100]
    return data
