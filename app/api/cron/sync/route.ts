import { NextResponse } from "next/server";
import { sendLatestReportIfNeeded } from "@/lib/report-delivery";

export const runtime = "nodejs";

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendLatestReportIfNeeded();

  return NextResponse.json({ ok: true, result });
}
