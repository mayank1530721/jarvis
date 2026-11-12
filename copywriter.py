"""Writes a YouTube title, description and tags that follow a campaign's rules.

Uses Google's Gemini API, which has a free tier (no card needed to get a key).
"""
import json
import os

import httpx

# "gemini-flash-latest" always points at Google's current fast model.
# If it ever stops working, set GEMINI_MODEL to a model name from Google AI Studio.
MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")

SYSTEM = (
    "You write metadata for YouTube Shorts. Follow the campaign rules exactly: "
    "required hashtags, mentions, disclosures, banned words, length limits. "
    "Never invent facts about the clip. Reply with JSON only, in this shape: "
    '{"title": string, "description": string, "tags": [string]}. '
    "Title max 100 characters."
)


class CopywriterError(Exception):
    pass


def write_metadata(campaign_rules: str, clip_notes: str) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
    body = {
        "system_instruction": {"parts": [{"text": SYSTEM}]},
        "contents": [
            {
                "parts": [
                    {
                        "text": f"CAMPAIGN RULES:\n{campaign_rules}\n\nABOUT THE CLIP:\n{clip_notes}"
                    }
                ]
            }
        ],
        "generationConfig": {"responseMimeType": "application/json"},
    }
    try:
        response = httpx.post(
            url,
            json=body,
            headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]},
            timeout=60,
        )
    except httpx.HTTPError as error:
        raise CopywriterError(f"Could not reach Gemini: {error}") from error
    if response.status_code == 429:
        raise CopywriterError(
            "Hit the free daily or per-minute limit. Wait a bit and try again."
        )
    if response.status_code != 200:
        raise CopywriterError(f"Gemini error {response.status_code}: {response.text[:200]}")
    try:
        text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
        data = json.loads(text)
        data["title"] = str(data["title"])[:100]
        data["description"] = str(data["description"])
        data["tags"] = [str(tag) for tag in data.get("tags", [])]
    except (KeyError, IndexError, ValueError) as error:
        raise CopywriterError("Gemini sent back something I could not read. Try again.") from error
    return data
