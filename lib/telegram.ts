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

const telegramTextLimit = 3900;

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

function splitTelegramText(text: string) {
  if (text.length <= telegramTextLimit) {
    return [text];
  }

  const chunks: string[] = [];
  let rest = text;

  while (rest.length > telegramTextLimit) {
    let splitAt = rest.lastIndexOf("\n\n", telegramTextLimit);

    if (splitAt < telegramTextLimit * 0.55) {
      splitAt = rest.lastIndexOf("\n", telegramTextLimit);
    }

    if (splitAt < telegramTextLimit * 0.55) {
      splitAt = rest.lastIndexOf(" ", telegramTextLimit);
    }

    if (splitAt < 1) {
      splitAt = telegramTextLimit;
    }

    chunks.push(rest.slice(0, splitAt).trimEnd());
    rest = rest.slice(splitAt).trimStart();
  }

  if (rest) {
    chunks.push(rest);
  }

  return chunks;
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
  const chunks = splitTelegramText(input.text);
  const results: unknown[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: input.parseMode,
          disable_web_page_preview: true,
          reply_markup:
            index === chunks.length - 1 ? input.replyMarkup : undefined,
        }),
      },
    );

    const payload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      throw new Error(`Telegram sendMessage failed with ${response.status}.`);
    }

    results.push(payload);
  }

  return results.length === 1 ? results[0] : results;
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
