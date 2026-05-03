import { NextResponse } from "next/server";
import { handleTelegramCallback } from "@/lib/telegram-menu";
import { handleTelegramMessage } from "@/lib/telegram-commands";
import { sendTelegramMessage } from "@/lib/telegram";

export const runtime = "nodejs";

type TelegramUpdate = {
  message?: {
    chat: {
      id: number | string;
    };
    document?: {
      file_id: string;
      file_name?: string;
      file_size?: number;
      mime_type?: string;
    };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      message_id: number;
      chat: {
        id: number | string;
      };
    };
  };
};

function verifyTelegramSecret(request: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!expected) {
    return true;
  }

  return request.headers.get("x-telegram-bot-api-secret-token") === expected;
}

export async function POST(request: Request) {
  if (!verifyTelegramSecret(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;

  if (update.message) {
    try {
      await handleTelegramMessage(update.message, request.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";

      await sendTelegramMessage({
        chatId: String(update.message.chat.id),
        text: `Ошибка: ${message}`,
      }).catch(() => undefined);
    }
  }

  if (update.callback_query) {
    try {
      await handleTelegramCallback(update.callback_query);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const chatId = update.callback_query.message?.chat.id;

      if (chatId !== undefined) {
        await sendTelegramMessage({
          chatId: String(chatId),
          text: `Ошибка меню: ${message}`,
        }).catch(() => undefined);
      }
    }
  }

  return NextResponse.json({ ok: true });
}

export function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "telegram-webhook",
  });
}
