"""Publishing step.

Right now this does NOT post anything. Uplika has no public API that this
project can rely on, so publishing is done through Claude's Uplika connection
in the Claude chat. When you have a real way to publish (an Uplika API key, or
YouTube's official upload API), put it in publish_clip() below.
"""


def publish_clip(title: str, description: str, tags: list[str]) -> str:
    return (
        "Approved. Publishing is not wired up yet, so copy the title and "
        "description above into Uplika, or ask Claude in the chat to publish it."
    )
