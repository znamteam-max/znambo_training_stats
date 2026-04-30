export type StravaTokenResponse = {
  token_type: "Bearer";
  expires_at: number;
  expires_in: number;
  refresh_token: string;
  access_token: string;
  athlete?: {
    id: number;
    username?: string;
    firstname?: string;
    lastname?: string;
  };
};

export const STRAVA_SCOPES = ["read", "activity:read_all"] as const;

export class StravaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StravaConfigError";
  }
}

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new StravaConfigError(`${name} is not configured.`);
  }

  return value;
}

export function buildStravaAuthUrl(state: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const redirectUri =
    process.env.STRAVA_REDIRECT_URI ??
    (appUrl ? `${appUrl}/api/strava/callback` : undefined);

  if (!redirectUri) {
    throw new StravaConfigError(
      "STRAVA_REDIRECT_URI or NEXT_PUBLIC_APP_URL is not configured.",
    );
  }

  const params = new URLSearchParams({
    client_id: requireEnv("STRAVA_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: STRAVA_SCOPES.join(","),
    state,
  });

  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

export async function refreshStravaToken(refreshToken: string) {
  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_id: requireEnv("STRAVA_CLIENT_ID"),
      client_secret: requireEnv("STRAVA_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const payload = (await response.json()) as StravaTokenResponse;

  if (!response.ok) {
    throw new Error(`Strava token refresh failed with ${response.status}.`);
  }

  return payload;
}
