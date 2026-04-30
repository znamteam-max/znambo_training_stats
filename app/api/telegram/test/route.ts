import { NextResponse } from "next/server";
import { sendTelegramMessage, TelegramConfigError } from "@/lib/telegram";

export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await sendTelegramMessage({
      text: "Тест связи. Бот жив, дальше будем считать тренировки без фантазий.",
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = error instanceof TelegramConfigError ? 500 : 502;

    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
