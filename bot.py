"""Telegram bot: paste campaign rules, describe a clip (text or voice note), approve the draft."""
from dotenv import load_dotenv

# Read the .env file when running on your own computer. Hosts that set the variables directly are unaffected.
# This must run before the local modules below are imported, because they read settings when imported.
load_dotenv()

import asyncio
import logging
import os

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from copywriter import CopywriterError, write_metadata
from publisher import PublishError, publish_clip
from transcribe import TranscribeError, transcribe

logging.basicConfig(level=logging.INFO)
OWNER_ID = int(os.environ["OWNER_TELEGRAM_ID"])
NO_RULES = "No campaign rules given."


def owner_only(handler):
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE):
        if update.effective_user and update.effective_user.id == OWNER_ID:
            return await handler(update, context)

    return wrapper


def text_after_command(update: Update) -> str:
    """Everything after the /command, keeping line breaks."""
    parts = (update.message.text or "").split(maxsplit=1)
    return parts[1].strip() if len(parts) > 1 else ""


def format_draft(draft: dict) -> str:
    return (
        f"Title:\n{draft['title']}\n\nDescription:\n{draft['description']}\n\n"
        f"Tags: {', '.join(draft['tags'])}"
    )


APPROVE_BUTTONS = InlineKeyboardMarkup(
    [[
        InlineKeyboardButton("Approve", callback_data="approve"),
        InlineKeyboardButton("Redo", callback_data="redo"),
    ]]
)


async def make_draft(message, context: ContextTypes.DEFAULT_TYPE, notes: str):
    context.user_data["notes"] = notes
    await message.reply_text("Writing a draft...")
    try:
        draft = await asyncio.to_thread(
            write_metadata, context.user_data.get("rules", NO_RULES), notes
        )
    except CopywriterError as error:
        await message.reply_text(str(error))
        return
    except Exception:
        logging.exception("copywriter failed")
        await message.reply_text("Something went wrong writing the draft. Try again.")
        return
    context.user_data["draft"] = draft
    await message.reply_text(format_draft(draft), reply_markup=APPROVE_BUTTONS)


@owner_only
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Jarvis for ClipCore is online.\n\n"
        "1) /rules <paste the campaign rules>\n"
        "2) /clip <a line or two about the clip>, or just send a voice note\n"
        "I'll draft the title and description, and you approve or redo."
    )


@owner_only
async def rules(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = text_after_command(update)
    if not text:
        await update.message.reply_text("Send it like this: /rules <the campaign rules>")
        return
    context.user_data["rules"] = text
    await update.message.reply_text("Rules saved. Now send /clip or a voice note about the clip.")


@owner_only
async def clip(update: Update, context: ContextTypes.DEFAULT_TYPE):
    notes = text_after_command(update)
    if not notes:
        await update.message.reply_text("Send it like this: /clip <what happens in the clip>")
        return
    await make_draft(update.message, context, notes)


@owner_only
async def voice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Listening...")
    try:
        telegram_file = await update.message.voice.get_file()
        audio = bytes(await telegram_file.download_as_bytearray())
        notes = await asyncio.to_thread(transcribe, audio)
    except TranscribeError as error:
        await update.message.reply_text(str(error))
        return
    except Exception:
        logging.exception("voice failed")
        await update.message.reply_text("Could not read that voice note. Try again.")
        return
    if not notes:
        await update.message.reply_text("I could not hear anything in that voice note.")
        return
    await update.message.reply_text(f"I heard: {notes}")
    await make_draft(update.message, context, notes)


async def button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if query.from_user.id != OWNER_ID:
        return
    if query.data == "approve":
        draft = context.user_data.get("draft")
        if not draft:
            await query.message.reply_text("No draft to approve. Send /clip first.")
            return
        try:
            result = await publish_clip(draft["title"], draft["description"], draft["tags"])
        except PublishError as error:
            result = f"Not published. {error}"
        await query.message.reply_text(result)
    elif query.data == "redo":
        notes = context.user_data.get("notes")
        if not notes:
            await query.message.reply_text("Nothing to redo. Send /clip first.")
            return
        await make_draft(query.message, context, notes)


def main():
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    app = Application.builder().token(token).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("rules", rules))
    app.add_handler(CommandHandler("clip", clip))
    app.add_handler(MessageHandler(filters.VOICE, voice))
    app.add_handler(CallbackQueryHandler(button))

    webhook_url = os.environ.get("WEBHOOK_URL")
    if webhook_url:
        # For free hosts that sleep: Telegram wakes the bot when a message arrives.
        app.run_webhook(
            listen="0.0.0.0",
            port=int(os.environ.get("PORT", "8080")),
            url_path=token,
            webhook_url=f"{webhook_url.rstrip('/')}/{token}",
        )
    else:
        # For running on your own computer.
        app.run_polling()


if __name__ == "__main__":
    main()
