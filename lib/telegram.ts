export class TelegramConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramConfigError";
  }
}

type SendTelegramMessageInput = {
  chatId?: string;
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
  replyMarkup?: TelegramReplyMarkup;
};

const telegramTextLimit = 4000;

export type TelegramInlineKeyboardButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

export type TelegramReplyMarkup = {
  inline_keyboard: TelegramInlineKeyboardButton[][];
};

function limitTelegramText(text: string) {
  if (text.length <= telegramTextLimit) {
    return text;
  }

  return `${text.slice(0, telegramTextLimit - 40)}\n\n[ответ обрезан: лимит Telegram]`;
}

function getTelegramToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new TelegramConfigError("TELEGRAM_BOT_TOKEN is not configured.");
  }

  return token;
}

function getTelegramChatId(chatId?: string) {
  const resolvedChatId = chatId ?? process.env.TELEGRAM_CHAT_ID;

  if (!resolvedChatId) {
    throw new TelegramConfigError("TELEGRAM_CHAT_ID is not configured.");
  }

  return resolvedChatId;
}

export async function sendTelegramMessage(input: SendTelegramMessageInput) {
  const token = getTelegramToken();
  const chatId = getTelegramChatId(input.chatId);

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: limitTelegramText(input.text),
        parse_mode: input.parseMode,
        disable_web_page_preview: true,
        reply_markup: input.replyMarkup,
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed with ${response.status}.`);
  }

  return payload;
}

export async function editTelegramMessage(input: {
  chatId: string;
  messageId: number;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
}) {
  const token = getTelegramToken();
  const response = await fetch(
    `https://api.telegram.org/bot${token}/editMessageText`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chat_id: input.chatId,
        message_id: input.messageId,
        text: limitTelegramText(input.text),
        disable_web_page_preview: true,
        reply_markup: input.replyMarkup,
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(`Telegram editMessageText failed with ${response.status}.`);
  }

  return payload;
}

export async function answerTelegramCallback(input: {
  callbackQueryId: string;
  text?: string;
}) {
  const token = getTelegramToken();
  const response = await fetch(
    `https://api.telegram.org/bot${token}/answerCallbackQuery`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        callback_query_id: input.callbackQueryId,
        text: input.text,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Telegram answerCallbackQuery failed with ${response.status}.`);
  }
}
