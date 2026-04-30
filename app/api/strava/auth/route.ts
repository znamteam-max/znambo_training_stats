import { NextResponse } from "next/server";
import { createOAuthState } from "@/lib/oauth-state";
import { buildStravaAuthUrl } from "@/lib/strava";

export const runtime = "nodejs";

function getRedirectUri(request: Request) {
  return (
    process.env.STRAVA_REDIRECT_URI ??
    new URL("/api/strava/callback", request.url).toString()
  );
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const telegramChatId = url.searchParams.get("telegramChatId") ?? undefined;
  const state = createOAuthState({ telegramChatId });
  const authUrl = buildStravaAuthUrl({
    state,
    redirectUri: getRedirectUri(request),
  });

  return NextResponse.redirect(authUrl);
}
