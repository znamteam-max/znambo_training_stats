import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { sendLatestReportIfNeeded } from "@/lib/report-delivery";

export const runtime = "nodejs";

type StravaWebhookEvent = {
  object_type?: string;
  aspect_type?: string;
  object_id?: number;
  owner_id?: number;
};

function verifyStravaSignature(request: Request, body: string) {
  const signingSecret = process.env.STRAVA_WEBHOOK_SIGNING_SECRET;

  if (!signingSecret) {
    return true;
  }

  const signatureHeader = request.headers.get("x-strava-signature");

  if (!signatureHeader) {
    return false;
  }

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => part.split("=", 2)),
  );
  const timestamp = parts.t;
  const signature = parts.v1;

  if (!timestamp || !signature) {
    return false;
  }

  const timestampSeconds = Number(timestamp);
  const toleranceSeconds = 300;

  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) > toleranceSeconds
  ) {
    return false;
  }

  const expectedSignature = createHmac("sha256", signingSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const received = Buffer.from(signature, "hex");
  const expected = Buffer.from(expectedSignature, "hex");

  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

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
  const body = await request.text();

  if (!verifyStravaSignature(request, body)) {
    return NextResponse.json(
      { ok: false, error: "Invalid signature" },
      { status: 401 },
    );
  }

  const event = JSON.parse(body) as StravaWebhookEvent;
  const ownerId = event.owner_id;

  if (
    event.object_type === "activity" &&
    (event.aspect_type === "create" || event.aspect_type === "update") &&
    ownerId
  ) {
    after(async () => {
      await sendLatestReportIfNeeded({
        stravaAthleteId: BigInt(ownerId),
      }).catch(() => undefined);
    });
  }

  return NextResponse.json({ ok: true });
}
