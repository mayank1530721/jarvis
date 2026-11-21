"""
Jarvis v0.1 - a text chatbot in your terminal.
Uses only Python's built-in libraries, so nothing to install.

Setup:
1. Get a free API key at https://console.groq.com/keys
2. Put it in an environment variable called GROQ_API_KEY
   Windows (Command Prompt):  setx GROQ_API_KEY "your-key-here"
   (then close and reopen the terminal)
3. Run:  python jarvis.py
"""

import json
import os
import urllib.request

API_KEY = os.environ.get("GROQ_API_KEY")
URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "llama-3.3-70b-versatile"

# This message defines Jarvis's personality. Try changing it!
messages = [
    {
        "role": "system",
        "content": "You are Jarvis, a witty, helpful AI assistant. "
                   "Keep answers short and clear.",
    }
]


def ask(messages):
    body = json.dumps({"model": MODEL, "messages": messages}).encode()
    req = urllib.request.Request(
        URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        },
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"]


def main():
    if not API_KEY:
        print("No API key found. Read the setup steps at the top of this file.")
        return
    print("Jarvis online. Type 'quit' to exit.\n")
    while True:
        user = input("You: ").strip()
        if user.lower() in ("quit", "exit"):
            print("Jarvis: Goodbye.")
            break
        if not user:
            continue
        messages.append({"role": "user", "content": user})
        try:
            reply = ask(messages)
        except Exception as e:
            print("Jarvis: Something went wrong:", e)
            messages.pop()
            continue
        messages.append({"role": "assistant", "content": reply})
        print("Jarvis:", reply, "\n")


main()
