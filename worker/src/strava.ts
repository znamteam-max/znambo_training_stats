import type {
  Env,
  StravaStreamSet,
  StravaSummaryActivity,
  StravaTokenResponse,
} from "./types";

const stravaScopes = ["read", "activity:read", "activity:read_all"];

function requireEnv(env: Env, name: keyof Env) {
  const value = env[name];

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

export function buildStravaAuthUrl(
  env: Env,
  input: {
    state: string;
    redirectUri: string;
  },
) {
  const params = new URLSearchParams({
    client_id: requireEnv(env, "STRAVA_CLIENT_ID"),
    redirect_uri: input.redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: stravaScopes.join(","),
    state: input.state,
  });

  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

async function requestStravaToken(env: Env, body: Record<string, string>) {
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

export async function exchangeStravaCodeForToken(
  env: Env,
  input: {
    code: string;
    redirectUri: string;
  },
) {
  return requestStravaToken(env, {
    client_id: requireEnv(env, "STRAVA_CLIENT_ID"),
    client_secret: requireEnv(env, "STRAVA_CLIENT_SECRET"),
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
  });
}

export async function refreshStravaToken(env: Env, refreshToken: string) {
  return requestStravaToken(env, {
    client_id: requireEnv(env, "STRAVA_CLIENT_ID"),
    client_secret: requireEnv(env, "STRAVA_CLIENT_SECRET"),
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

export async function fetchStravaActivities(
  accessToken: string,
  input?: {
    perPage?: number;
    page?: number;
  },
) {
  const perPage = input?.perPage ?? 20;
  const page = input?.page ?? 1;

  return stravaApiFetch<StravaSummaryActivity[]>(
    accessToken,
    `/athlete/activities?per_page=${perPage}&page=${page}`,
  );
}

export async function fetchLatestStravaActivity(accessToken: string) {
  const activities = await fetchStravaActivities(accessToken, { perPage: 1 });

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
