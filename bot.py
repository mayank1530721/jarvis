"""Telegram bot: paste campaign rules, describe a clip, approve the draft."""
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

from copywriter import write_metadata
from publisher import publish_clip

logging.basicConfig(level=logging.INFO)
OWNER_ID = int(os.environ["OWNER_TELEGRAM_ID"])


def owner_only(handler):
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE):
        if update.effective_user and update.effective_user.id == OWNER_ID:
            return await handler(update, context)
    return wrapper


@owner_only
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Jarvis for ClipCore is online.\n\n"
        "1) /rules <paste the campaign rules>\n"
        "2) /clip <one or two lines about the clip>\n"
        "I'll draft the title and description, and you approve or redo."
    )


@owner_only
async def rules(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = " ".join(context.args)
    if not text:
        await update.message.reply_text("Send it like this: /rules <the campaign rules>")
        return
    context.user_data["rules"] = text
    await update.message.reply_text("Rules saved. Now send /clip <about the clip>.")


@owner_only
async def clip(update: Update, context: ContextTypes.DEFAULT_TYPE):
    notes = " ".join(context.args)
    if not notes:
        await update.message.reply_text("Send it like this: /clip <what happens in the clip>")
        return
    campaign_rules = context.user_data.get("rules", "No campaign rules given.")
    context.user_data["notes"] = notes
    await update.message.reply_text("Writing a draft...")
    try:
        draft = write_metadata(campaign_rules, notes)
    except Exception as error:
        logging.exception("copywriter failed")
        await update.message.reply_text(f"Could not write the draft: {error}")
        return
    context.user_data["draft"] = draft
    buttons = InlineKeyboardMarkup(
        [[
            InlineKeyboardButton("Approve", callback_data="approve"),
            InlineKeyboardButton("Redo", callback_data="redo"),
        ]]
    )
    await update.message.reply_text(
        f"Title:\n{draft['title']}\n\nDescription:\n{draft['description']}\n\n"
        f"Tags: {', '.join(draft['tags'])}",
        reply_markup=buttons,
    )


async def button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if query.from_user.id != OWNER_ID:
        return
    draft = context.user_data.get("draft")
    if query.data == "approve" and draft:
        result = publish_clip(draft["title"], draft["description"], draft["tags"])
        await query.message.reply_text(result)
    elif query.data == "redo":
        try:
            draft = write_metadata(
                context.user_data.get("rules", "No campaign rules given."),
                context.user_data.get("notes", ""),
            )
        except Exception as error:
            await query.message.reply_text(f"Could not write the draft: {error}")
            return
        context.user_data["draft"] = draft
        await query.message.reply_text(
            f"New draft.\n\nTitle:\n{draft['title']}\n\nDescription:\n{draft['description']}\n\n"
            f"Tags: {', '.join(draft['tags'])}\n\nSend /clip again to get approve buttons."
        )


def main():
    app = Application.builder().token(os.environ["TELEGRAM_BOT_TOKEN"]).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("rules", rules))
    app.add_handler(CommandHandler("clip", clip))
    app.add_handler(CallbackQueryHandler(button))
    app.run_polling()


if __name__ == "__main__":
    main()
