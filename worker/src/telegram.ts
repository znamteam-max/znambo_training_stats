import type { Env } from "./types";

type SendTelegramMessageInput = {
  env: Env;
  chatId?: string;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
};

type TelegramSendMessagePayload = {
  result?: {
    message_id?: number;
  };
};

type TelegramGetFilePayload = {
  result?: {
    file_path?: string;
  };
  description?: string;
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

function getTelegramToken(env: Env) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  return env.TELEGRAM_BOT_TOKEN;
}

function getTelegramChatId(env: Env, chatId?: string) {
  const resolvedChatId = chatId ?? env.TELEGRAM_CHAT_ID;

  if (!resolvedChatId) {
    throw new Error("TELEGRAM_CHAT_ID is not configured.");
  }

  return resolvedChatId;
}

export function getTelegramMessageId(payload: unknown) {
  if (Array.isArray(payload)) {
    return getTelegramMessageId(payload.at(-1));
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const messageId = (payload as TelegramSendMessagePayload).result?.message_id;

  return typeof messageId === "number" ? messageId : null;
}

export async function sendTelegramMessage(input: SendTelegramMessageInput) {
  const token = getTelegramToken(input.env);
  const chatId = getTelegramChatId(input.env, input.chatId);
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
  env: Env;
  chatId: string;
  messageId: number;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
}) {
  const token = getTelegramToken(input.env);
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
        text: input.text.slice(0, telegramTextLimit),
        disable_web_page_preview: true,
        reply_markup: input.replyMarkup,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Telegram editMessageText failed with ${response.status}.`);
  }
}

export async function answerTelegramCallback(input: {
  env: Env;
  callbackQueryId: string;
  text?: string;
}) {
  const token = getTelegramToken(input.env);
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

export async function sendTelegramChatAction(input: {
  env: Env;
  chatId?: string;
  action?: "typing";
}) {
  const token = getTelegramToken(input.env);
  const chatId = getTelegramChatId(input.env, input.chatId);
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendChatAction`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        action: input.action ?? "typing",
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Telegram sendChatAction failed with ${response.status}.`);
  }
}

export async function deleteTelegramMessage(input: {
  env: Env;
  chatId: string;
  messageId: number;
}) {
  const token = getTelegramToken(input.env);
  const response = await fetch(
    `https://api.telegram.org/bot${token}/deleteMessage`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chat_id: input.chatId,
        message_id: input.messageId,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Telegram deleteMessage failed with ${response.status}.`);
  }
}

export async function downloadTelegramFile(env: Env, fileId: string) {
  const token = getTelegramToken(env);
  const fileResponse = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(
      fileId,
    )}`,
  );
  const filePayload = (await fileResponse.json().catch(() => null)) as
    | TelegramGetFilePayload
    | null;

  if (!fileResponse.ok || !filePayload?.result?.file_path) {
    throw new Error(
      filePayload?.description ??
        `Telegram getFile failed with ${fileResponse.status}.`,
    );
  }

  const downloadResponse = await fetch(
    `https://api.telegram.org/file/bot${token}/${filePayload.result.file_path}`,
  );

  if (!downloadResponse.ok) {
    throw new Error(
      `Telegram file download failed with ${downloadResponse.status}.`,
    );
  }

  return Buffer.from(await downloadResponse.arrayBuffer());
}
