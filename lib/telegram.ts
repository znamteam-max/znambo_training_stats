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
};

const telegramTextLimit = 4000;

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
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed with ${response.status}.`);
  }

  return payload;
}
