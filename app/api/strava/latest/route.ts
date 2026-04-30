import { NextResponse } from "next/server";
import { processLatestActivity } from "@/lib/activity-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const telegramChatId = url.searchParams.get("telegramChatId") ?? undefined;
  const result = await processLatestActivity({ telegramChatId });

  if (!result) {
    return NextResponse.json({ ok: true, activity: null });
  }

  return NextResponse.json({
    ok: true,
    activityId: result.activity.id,
    stravaActivityId: result.activity.stravaActivityId.toString(),
    metrics: result.metrics,
    report: result.reportText,
  });
}
