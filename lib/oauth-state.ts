import { createHmac, timingSafeEqual } from "node:crypto";

export type OAuthStatePayload = {
  telegramChatId?: string;
  createdAt: number;
};

class OAuthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthStateError";
  }
}

function getStateSecret() {
  const secret =
    process.env.STRAVA_OAUTH_STATE_SECRET ??
    process.env.TELEGRAM_WEBHOOK_SECRET ??
    process.env.STRAVA_CLIENT_SECRET;

  if (!secret) {
    throw new OAuthStateError(
      "STRAVA_OAUTH_STATE_SECRET, TELEGRAM_WEBHOOK_SECRET, or STRAVA_CLIENT_SECRET is required.",
    );
  }

  return secret;
}

function sign(payload: string) {
  return createHmac("sha256", getStateSecret())
    .update(payload)
    .digest("base64url");
}

export function createOAuthState(input: { telegramChatId?: string }) {
  const payload: OAuthStatePayload = {
    telegramChatId: input.telegramChatId,
    createdAt: Date.now(),
  };

  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );

  return `${encoded}.${sign(encoded)}`;
}

export function parseOAuthState(state: string) {
  const [encoded, signature] = state.split(".");

  if (!encoded || !signature) {
    throw new OAuthStateError("Invalid OAuth state.");
  }

  const expectedSignature = sign(encoded);
  const received = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    throw new OAuthStateError("OAuth state signature mismatch.");
  }

  const payload = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as OAuthStatePayload;

  const maxAgeMs = 1000 * 60 * 30;

  if (Date.now() - payload.createdAt > maxAgeMs) {
    throw new OAuthStateError("OAuth state expired.");
  }

  return payload;
}
