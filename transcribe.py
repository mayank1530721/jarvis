"""Turns a Telegram voice note into text using Groq's free Whisper speech-to-text."""
import os

import httpx

URL = "https://api.groq.com/openai/v1/audio/transcriptions"
MODEL = os.environ.get("GROQ_STT_MODEL", "whisper-large-v3-turbo")


class TranscribeError(Exception):
    pass


def transcribe(audio_bytes: bytes) -> str:
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        raise TranscribeError("Voice notes need a free Groq key. See the README.")
    try:
        response = httpx.post(
            URL,
            headers={"Authorization": f"Bearer {key}"},
            files={"file": ("voice.ogg", audio_bytes, "audio/ogg")},
            data={"model": MODEL},
            timeout=60,
        )
    except httpx.HTTPError as error:
        raise TranscribeError(f"Could not reach Groq: {error}") from error
    if response.status_code == 429:
        raise TranscribeError("Hit the free speech limit. Wait a bit and try again.")
    if response.status_code != 200:
        raise TranscribeError(f"Groq error {response.status_code}: {response.text[:200]}")
    return response.json().get("text", "").strip()
