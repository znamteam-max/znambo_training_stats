import { NextResponse } from "next/server";
import { parseOAuthState } from "@/lib/oauth-state";
import { storeStravaAuthorization } from "@/lib/activity-service";
import { exchangeStravaCodeForToken } from "@/lib/strava";
import { sendTelegramMessage } from "@/lib/telegram";

export const runtime = "nodejs";

function getRedirectUri(request: Request) {
  return (
    process.env.STRAVA_REDIRECT_URI ??
    new URL("/api/strava/callback", request.url).toString()
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const scope = url.searchParams.get("scope") ?? undefined;
  const state = url.searchParams.get("state");

  if (error) {
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }

  if (!code || !state) {
    return NextResponse.json(
      { ok: false, error: "Missing Strava code or state." },
      { status: 400 },
    );
  }

  const parsedState = parseOAuthState(state);
  const token = await exchangeStravaCodeForToken({
    code,
    redirectUri: getRedirectUri(request),
  });
  const athlete = await storeStravaAuthorization({
    token,
    scope,
    telegramChatId: parsedState.telegramChatId,
  });

  if (parsedState.telegramChatId) {
    await sendTelegramMessage({
      chatId: parsedState.telegramChatId,
      text: "Strava подключена. Теперь жми /last, посмотрим последнюю тренировку без розовых очков.",
    }).catch(() => undefined);
  }

  return NextResponse.json({
    ok: true,
    athleteId: athlete.id,
    stravaAthleteId: athlete.stravaAthleteId?.toString(),
  });
}
