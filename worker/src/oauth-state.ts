import { createHmac, timingSafeEqual } from "node:crypto";
import type { Env } from "./types";

type OAuthStatePayload = {
  telegramChatId?: string;
  createdAt: number;
};

function getStateSecret(env: Env) {
  const secret =
    env.STRAVA_OAUTH_STATE_SECRET ??
    env.TELEGRAM_WEBHOOK_SECRET ??
    env.STRAVA_CLIENT_SECRET;

  if (!secret) {
    throw new Error(
      "STRAVA_OAUTH_STATE_SECRET, TELEGRAM_WEBHOOK_SECRET, or STRAVA_CLIENT_SECRET is required.",
    );
  }

  return secret;
}

function sign(env: Env, payload: string) {
  return createHmac("sha256", getStateSecret(env))
    .update(payload)
    .digest("base64url");
}

export function createOAuthState(env: Env, input: { telegramChatId?: string }) {
  const payload: OAuthStatePayload = {
    telegramChatId: input.telegramChatId,
    createdAt: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );

  return `${encoded}.${sign(env, encoded)}`;
}

export function parseOAuthState(env: Env, state: string) {
  const [encoded, signature] = state.split(".");

  if (!encoded || !signature) {
    throw new Error("Invalid OAuth state.");
  }

  const expectedSignature = sign(env, encoded);
  const received = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    throw new Error("OAuth state signature mismatch.");
  }

  const payload = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as OAuthStatePayload;
  const maxAgeMs = 1000 * 60 * 30;

  if (Date.now() - payload.createdAt > maxAgeMs) {
    throw new Error("OAuth state expired.");
  }

  return payload;
}
