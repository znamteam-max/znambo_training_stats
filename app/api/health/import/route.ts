import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  buildDailyHealthSummary,
  upsertDailyHealthLog,
  type DailyHealthImportInput,
} from "@/lib/health-service";

export const runtime = "nodejs";

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";

  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return request.headers.get("x-health-import-secret") ?? "";
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function verifyImportSecret(request: Request) {
  const expected = process.env.HEALTH_IMPORT_SECRET;

  if (!expected) {
    throw new Error("HEALTH_IMPORT_SECRET is not configured.");
  }

  return safeEqual(getBearerToken(request), expected);
}

export async function POST(request: Request) {
  if (!verifyImportSecret(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json()) as DailyHealthImportInput;

  if (!payload.telegramChatId) {
    return NextResponse.json(
      { ok: false, error: "telegramChatId is required." },
      { status: 400 },
    );
  }

  const log = await upsertDailyHealthLog(payload);

  return NextResponse.json({
    ok: true,
    date: log.date.toISOString().slice(0, 10),
    summary: buildDailyHealthSummary(log),
  });
}

export function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "health-import",
  });
}
