"""Publishing step: sends the approved title and description to your channels through Uplika.

Needs UPLIKA_API_KEY in .env (create one under API Keys in the Uplika dashboard). Without it, this only
tells you to copy the text by hand. UPLIKA_ACCOUNT_IDS is optional: comma-separated channel ids to post
to; if empty, every active channel is used.

Limit: this sends text only. A channel that requires a video (YouTube Shorts, Instagram Reels) will be
refused by Uplika with a clear message, so those still need the video attached in Uplika itself.
"""
import os

import httpx

BASE = "https://api.uplika.com/v1"
_transport = None  # tests replace this with a fake


class PublishError(Exception):
    pass


def _explain(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        body = {}
    err = body.get("error") if isinstance(body, dict) else None
    message = (body.get("message") if isinstance(body, dict) else None) or (err.get("message") if isinstance(err, dict) else err) or ""
    if response.status_code in (401, 403):
        return "Uplika rejected the API key. Check UPLIKA_API_KEY in .env."
    if response.status_code == 429:
        return "Uplika says slow down. Try again in a minute."
    return f"Uplika error {response.status_code}" + (f": {message}" if message else ".")


async def publish_clip(title: str, description: str, tags: list[str]) -> str:
    key = os.environ.get("UPLIKA_API_KEY", "").strip()
    if not key:
        return (
            "Approved. Publishing is not connected, so copy the title and description above into Uplika. "
            "To connect it, add UPLIKA_API_KEY to .env."
        )
    headers = {"authorization": f"Bearer {key}"}
    try:
        async with httpx.AsyncClient(timeout=30, headers=headers, transport=_transport) as client:
            ids = [i.strip() for i in os.environ.get("UPLIKA_ACCOUNT_IDS", "").split(",") if i.strip()]
            if not ids:
                response = await client.get(f"{BASE}/accounts")
                if response.status_code != 200:
                    raise PublishError(_explain(response))
                body = response.json()
                rows = body.get("data", body.get("accounts", [])) if isinstance(body, dict) else body
                ids = [a["id"] for a in rows if a.get("id") and a.get("status", "active") == "active"]
            if not ids:
                raise PublishError("No connected channels found. Connect one at https://uplika.com/dashboard/connections.")
            text = f"{title}\n\n{description}".strip()
            response = await client.post(f"{BASE}/posts", json={"content": text, "accountIds": ids})
            if response.status_code >= 400:
                raise PublishError(_explain(response))
    except httpx.HTTPError as error:
        raise PublishError(f"Could not reach Uplika: {error}") from error
    return f"Sent to Uplika for {len(ids)} channel(s). Check the Uplika dashboard to see it go out."
