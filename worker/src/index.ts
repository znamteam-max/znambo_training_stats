import { timingSafeEqual } from "node:crypto";
import {
  getRedirectUri,
  handleTelegramCallback,
  handleTelegramMessage,
} from "./commands";
import {
  getLatestDailyHealthLog,
  markActivityReportSent,
  processLatestActivity,
  storeStravaAuthorization,
  upsertDailyHealthLog,
} from "./db";
import { buildDailyHealthSummary, type DailyHealthImportInput } from "./health";
import { createOAuthState, parseOAuthState } from "./oauth-state";
import { buildStravaAuthUrl, exchangeStravaCodeForToken } from "./strava";
import { sendTelegramMessage } from "./telegram";
import type { Env, TelegramCallbackQuery, TelegramMessage } from "./types";

type TelegramUpdate = {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init?.headers,
    },
  });
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function verifyTelegramSecret(env: Env, request: Request) {
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return true;
  }

  return (
    request.headers.get("x-telegram-bot-api-secret-token") ===
    env.TELEGRAM_WEBHOOK_SECRET
  );
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";

  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return request.headers.get("x-health-import-secret") ?? "";
}

function verifyHealthSecret(env: Env, request: Request) {
  if (!env.HEALTH_IMPORT_SECRET) {
    throw new Error("HEALTH_IMPORT_SECRET is not configured.");
  }

  return safeEqual(getBearerToken(request), env.HEALTH_IMPORT_SECRET);
}

function verifyCronSecret(env: Env, request: Request) {
  if (!env.CRON_SECRET) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`;
}

function hasEnvValue(env: Env, name: keyof Env) {
  const value = env[name];

  return typeof value === "string" && value.length > 0;
}

function handleDebugEnv(env: Env) {
  return json({
    ok: true,
    env: {
      ATHLETE_DEFAULT_FTP: hasEnvValue(env, "ATHLETE_DEFAULT_FTP"),
      ATHLETE_DEFAULT_WEIGHT_KG: hasEnvValue(env, "ATHLETE_DEFAULT_WEIGHT_KG"),
      CRON_SECRET: hasEnvValue(env, "CRON_SECRET"),
      DATABASE_URL: hasEnvValue(env, "DATABASE_URL"),
      HEALTH_IMPORT_SECRET: hasEnvValue(env, "HEALTH_IMPORT_SECRET"),
      OPENAI_API_KEY: hasEnvValue(env, "OPENAI_API_KEY"),
      OPENAI_MODEL: hasEnvValue(env, "OPENAI_MODEL"),
      STRAVA_CLIENT_ID: hasEnvValue(env, "STRAVA_CLIENT_ID"),
      STRAVA_CLIENT_SECRET: hasEnvValue(env, "STRAVA_CLIENT_SECRET"),
      STRAVA_OAUTH_STATE_SECRET: hasEnvValue(env, "STRAVA_OAUTH_STATE_SECRET"),
      STRAVA_REDIRECT_URI: hasEnvValue(env, "STRAVA_REDIRECT_URI"),
      TELEGRAM_BOT_TOKEN: hasEnvValue(env, "TELEGRAM_BOT_TOKEN"),
      TELEGRAM_CHAT_ID: hasEnvValue(env, "TELEGRAM_CHAT_ID"),
      TELEGRAM_WEBHOOK_SECRET: hasEnvValue(env, "TELEGRAM_WEBHOOK_SECRET"),
      TRAINING_TIMEZONE: hasEnvValue(env, "TRAINING_TIMEZONE"),
    },
  });
}

async function handleTelegramWebhook(env: Env, request: Request) {
  if (!verifyTelegramSecret(env, request)) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;

  if (update.message) {
    try {
      await handleTelegramMessage(env, update.message, request.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";

      await sendTelegramMessage({
        env,
        chatId: String(update.message.chat.id),
        text: `Ошибка: ${message}`,
      }).catch(() => undefined);
    }
  }

  if (update.callback_query) {
    try {
      await handleTelegramCallback(env, update.callback_query);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const chatId = update.callback_query.message?.chat.id;

      if (chatId !== undefined) {
        await sendTelegramMessage({
          env,
          chatId: String(chatId),
          text: `Ошибка меню: ${message}`,
        }).catch(() => undefined);
      }
    }
  }

  return json({ ok: true });
}

function handleStravaAuth(env: Env, request: Request) {
  const url = new URL(request.url);
  const telegramChatId = url.searchParams.get("telegramChatId") ?? undefined;
  const state = createOAuthState(env, { telegramChatId });
  const authUrl = buildStravaAuthUrl(env, {
    state,
    redirectUri: getRedirectUri(env, request.url),
  });

  return Response.redirect(authUrl, 302);
}

async function handleStravaCallback(env: Env, request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const scope = url.searchParams.get("scope") ?? undefined;
  const state = url.searchParams.get("state");

  if (error) {
    return json({ ok: false, error }, { status: 400 });
  }

  if (!code || !state) {
    return json(
      { ok: false, error: "Missing Strava code or state." },
      { status: 400 },
    );
  }

  const parsedState = parseOAuthState(env, state);
  const token = await exchangeStravaCodeForToken(env, {
    code,
    redirectUri: getRedirectUri(env, request.url),
  });
  const athlete = await storeStravaAuthorization(env, {
    token,
    scope,
    telegramChatId: parsedState.telegramChatId,
  });

  if (parsedState.telegramChatId) {
    await sendTelegramMessage({
      env,
      chatId: parsedState.telegramChatId,
      text: "Strava подключена. Теперь жми /last, посмотрим последнюю тренировку без розовых очков.",
    }).catch(() => undefined);
  }

  return json({
    ok: true,
    athleteId: athlete.id,
    stravaAthleteId: athlete.stravaAthleteId?.toString(),
  });
}

async function handleLatest(env: Env, request: Request) {
  const url = new URL(request.url);
  const telegramChatId = url.searchParams.get("telegramChatId") ?? undefined;
  const result = await processLatestActivity(env, { telegramChatId });

  return json({
    ok: true,
    activity: result
      ? {
          id: result.activity.id,
          name: result.activity.name,
          reportText: result.reportText,
        }
      : null,
  });
}

async function handleHealthImport(env: Env, request: Request) {
  if (!verifyHealthSecret(env, request)) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json()) as DailyHealthImportInput;

  if (!payload.telegramChatId) {
    return json(
      { ok: false, error: "telegramChatId is required." },
      { status: 400 },
    );
  }

  const log = await upsertDailyHealthLog(env, payload);

  return json({
    ok: true,
    date: log.date.toISOString().slice(0, 10),
    summary: buildDailyHealthSummary(log),
  });
}

async function handleHealth(env: Env, request: Request) {
  const url = new URL(request.url);
  const telegramChatId = url.searchParams.get("telegramChatId") ?? env.TELEGRAM_CHAT_ID;

  if (!telegramChatId) {
    return json(
      { ok: false, error: "telegramChatId or TELEGRAM_CHAT_ID is required." },
      { status: 400 },
    );
  }

  const log = await getLatestDailyHealthLog(env, telegramChatId);

  return json({ ok: true, summary: buildDailyHealthSummary(log) });
}

export async function sendLatestReportIfNeeded(env: Env) {
  const result = await processLatestActivity(env, {
    telegramChatId: env.TELEGRAM_CHAT_ID,
  });

  if (!result) {
    return { sent: false, reason: "no-activity" };
  }

  if (result.activity.reportSentAt) {
    return {
      sent: false,
      reason: "already-sent",
      activityId: result.activity.id,
    };
  }

  const chatId = result.athlete.telegramChatId ?? env.TELEGRAM_CHAT_ID;

  if (!chatId) {
    return {
      sent: false,
      reason: "no-telegram-chat",
      activityId: result.activity.id,
    };
  }

  await sendTelegramMessage({
    env,
    chatId,
    text: result.reportText,
  });

  await markActivityReportSent(env, result.activity.id);

  return {
    sent: true,
    activityId: result.activity.id,
  };
}

async function handleCronSync(env: Env, request: Request) {
  if (!verifyCronSecret(env, request)) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return json({ ok: true, result: await sendLatestReportIfNeeded(env) });
}

async function handleRequest(request: Request, env: Env) {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/api/telegram/webhook") {
    return handleTelegramWebhook(env, request);
  }

  if (request.method === "GET" && url.pathname === "/api/telegram/webhook") {
    return json({ ok: true, endpoint: "telegram-webhook-cloudflare" });
  }

  if (request.method === "GET" && url.pathname === "/api/strava/auth") {
    return handleStravaAuth(env, request);
  }

  if (request.method === "GET" && url.pathname === "/api/strava/callback") {
    return handleStravaCallback(env, request);
  }

  if (request.method === "GET" && url.pathname === "/api/strava/latest") {
    return handleLatest(env, request);
  }

  if (request.method === "POST" && url.pathname === "/api/health/import") {
    return handleHealthImport(env, request);
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    return handleHealth(env, request);
  }

  if (request.method === "GET" && url.pathname === "/api/cron/sync") {
    return handleCronSync(env, request);
  }

  if (request.method === "GET" && url.pathname === "/") {
    return json({ ok: true, service: "znambo-training-stats-worker" });
  }

  if (request.method === "GET" && url.pathname === "/api/debug/env") {
    return handleDebugEnv(env);
  }

  return json({ ok: false, error: "Not found" }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";

      return json(
        {
          ok: false,
          error: message,
        },
        { status: 500 },
      );
    }
  },
  scheduled(
    _event: unknown,
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ) {
    ctx.waitUntil(sendLatestReportIfNeeded(env).catch(() => undefined));
  },
};
