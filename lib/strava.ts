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

export type StravaSummaryActivity = {
  id: number;
  name?: string;
  type: string;
  sport_type?: string;
  start_date: string;
  elapsed_time?: number;
  moving_time?: number;
  distance?: number;
  average_watts?: number;
  weighted_average_watts?: number;
  average_heartrate?: number;
  max_heartrate?: number;
};

type StravaStream<T> = {
  original_size: number;
  resolution: string;
  series_type: string;
  data: T[];
};

export type StravaStreamSet = {
  time?: StravaStream<number>;
  watts?: StravaStream<number>;
  heartrate?: StravaStream<number>;
  cadence?: StravaStream<number>;
  distance?: StravaStream<number>;
};

export const STRAVA_SCOPES = [
  "read",
  "activity:read",
  "activity:read_all",
] as const;

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

export function buildStravaAuthUrl(input: {
  state: string;
  redirectUri?: string;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const redirectUri =
    input.redirectUri ??
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
    state: input.state,
  });

  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

async function requestStravaToken(body: Record<string, string>) {
  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });

  const payload = (await response.json()) as StravaTokenResponse;

  if (!response.ok) {
    throw new Error(`Strava token request failed with ${response.status}.`);
  }

  return payload;
}

export async function exchangeStravaCodeForToken(input: {
  code: string;
  redirectUri: string;
}) {
  return requestStravaToken({
    client_id: requireEnv("STRAVA_CLIENT_ID"),
    client_secret: requireEnv("STRAVA_CLIENT_SECRET"),
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
  });
}

export async function refreshStravaToken(refreshToken: string) {
  return requestStravaToken({
    client_id: requireEnv("STRAVA_CLIENT_ID"),
    client_secret: requireEnv("STRAVA_CLIENT_SECRET"),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

async function stravaApiFetch<T>(accessToken: string, path: string) {
  const response = await fetch(`https://www.strava.com/api/v3${path}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Strava API request failed with ${response.status}.`);
  }

  return (await response.json()) as T;
}

export async function fetchLatestStravaActivity(accessToken: string) {
  const activities = await stravaApiFetch<StravaSummaryActivity[]>(
    accessToken,
    "/athlete/activities?per_page=1&page=1",
  );

  return activities[0] ?? null;
}

export async function fetchStravaActivityStreams(
  accessToken: string,
  activityId: number,
) {
  const keys = ["time", "watts", "heartrate", "cadence", "distance"].join(",");

  return stravaApiFetch<StravaStreamSet>(
    accessToken,
    `/activities/${activityId}/streams?keys=${keys}&key_by_type=true`,
  );
}
