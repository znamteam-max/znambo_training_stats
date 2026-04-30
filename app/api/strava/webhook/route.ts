import { NextResponse } from "next/server";
import { sendLatestReportIfNeeded } from "@/lib/report-delivery";

export const runtime = "nodejs";

type StravaWebhookEvent = {
  object_type?: string;
  aspect_type?: string;
  object_id?: number;
  owner_id?: number;
};

export function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    challenge &&
    token === process.env.STRAVA_WEBHOOK_VERIFY_TOKEN
  ) {
    return NextResponse.json({ "hub.challenge": challenge });
  }

  return NextResponse.json(
    { ok: false, error: "Invalid webhook verification." },
    { status: 403 },
  );
}

export async function POST(request: Request) {
  const event = (await request.json()) as StravaWebhookEvent;

  if (
    event.object_type === "activity" &&
    (event.aspect_type === "create" || event.aspect_type === "update") &&
    event.owner_id
  ) {
    await sendLatestReportIfNeeded({
      stravaAthleteId: BigInt(event.owner_id),
    });
  }

  return NextResponse.json({ ok: true });
}
