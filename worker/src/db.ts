import { neon } from "@neondatabase/serverless";
import { calculateActivityMetrics } from "./metrics";
import { buildActivityReport } from "./report";
import {
  fetchLatestStravaActivity,
  fetchStravaActivities,
  fetchStravaActivityStreams,
  refreshStravaToken,
} from "./strava";
import type {
  Activity,
  Athlete,
  AthleteNote,
  DailyHealthLog,
  Env,
  StravaSummaryActivity,
  StravaTokenResponse,
} from "./types";
import type { ActivityMetrics } from "./metrics";
import type { DailyHealthImportInput } from "./health";
import { optionalInt, optionalNumber, parseDateOnly } from "./health";

const tokenRefreshBufferMs = 1000 * 60 * 5;

function db(env: Env) {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return neon(env.DATABASE_URL);
}

function id() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function toJson(value: unknown) {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

function toDate(value: unknown) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(String(value));

  return Number.isNaN(date.getTime()) ? null : date;
}

function toBigInt(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  return BigInt(String(value));
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function toInt(value: unknown) {
  const number = toNumber(value);

  return number === null ? null : Math.round(number);
}

function getDefaultFtp(env: Env) {
  return Number(env.ATHLETE_DEFAULT_FTP ?? 285);
}

function getDefaultWeightKg(env: Env) {
  const weight = env.ATHLETE_DEFAULT_WEIGHT_KG;

  return weight ? Number(weight) : null;
}

function mapAthlete(row: Record<string, unknown>): Athlete {
  return {
    id: String(row.id),
    stravaAthleteId: toBigInt(row.stravaAthleteId),
    stravaScope: row.stravaScope === null ? null : String(row.stravaScope),
    telegramChatId:
      row.telegramChatId === null ? null : String(row.telegramChatId),
    ftpWatts: Number(row.ftpWatts ?? 285),
    weightKg: toNumber(row.weightKg),
    accessToken: row.accessToken === null ? null : String(row.accessToken),
    refreshToken: row.refreshToken === null ? null : String(row.refreshToken),
    tokenExpiresAt: toDate(row.tokenExpiresAt),
    createdAt: toDate(row.createdAt) ?? new Date(),
  };
}

function mapActivity(row: Record<string, unknown>): Activity {
  return {
    id: String(row.id),
    athleteId: String(row.athleteId),
    stravaActivityId: BigInt(String(row.stravaActivityId)),
    type: String(row.type),
    name: row.name === null ? null : String(row.name),
    startDate: toDate(row.startDate) ?? new Date(),
    elapsedTimeSeconds: toInt(row.elapsedTimeSeconds),
    movingTimeSeconds: toInt(row.movingTimeSeconds),
    distanceMeters: toNumber(row.distanceMeters),
    averagePowerWatts: toNumber(row.averagePowerWatts),
    normalizedPowerWatts: toNumber(row.normalizedPowerWatts),
    intensityFactor: toNumber(row.intensityFactor),
    trainingStressScore: toNumber(row.trainingStressScore),
    averageHeartRate: toNumber(row.averageHeartRate),
    maxHeartRate: toInt(row.maxHeartRate),
    rawSummary: row.rawSummary ?? null,
    powerZoneSeconds: row.powerZoneSeconds ?? null,
    reportText: row.reportText === null ? null : String(row.reportText),
    reportSentAt: toDate(row.reportSentAt),
    createdAt: toDate(row.createdAt) ?? new Date(),
  };
}

function mapNote(row: Record<string, unknown>): AthleteNote {
  return {
    id: String(row.id),
    athleteId: String(row.athleteId),
    text: String(row.text),
    createdAt: toDate(row.createdAt) ?? new Date(),
  };
}

function mapHealthLog(row: Record<string, unknown>): DailyHealthLog {
  return {
    id: String(row.id),
    athleteId: String(row.athleteId),
    date: toDate(row.date) ?? new Date(),
    timezone: row.timezone === null ? null : String(row.timezone),
    activeEnergyKcal: toNumber(row.activeEnergyKcal),
    dietaryEnergyKcal: toNumber(row.dietaryEnergyKcal),
    proteinGrams: toNumber(row.proteinGrams),
    carbsGrams: toNumber(row.carbsGrams),
    fatGrams: toNumber(row.fatGrams),
    bodyMassKg: toNumber(row.bodyMassKg),
    sleepMinutes: toInt(row.sleepMinutes),
    restingHeartRateBpm: toNumber(row.restingHeartRateBpm),
    hrvMs: toNumber(row.hrvMs),
    steps: toInt(row.steps),
    source: row.source === null ? null : String(row.source),
    rawHealth: row.rawHealth ?? null,
  };
}

function pickConnectedAthlete(athletes: Athlete[]) {
  return athletes.find((athlete) => athlete.refreshToken) ?? athletes[0] ?? null;
}

export async function getOrCreateTelegramAthlete(env: Env, telegramChatId: string) {
  const sql = db(env);
  const rows = await sql`
    SELECT * FROM "Athlete"
    WHERE "telegramChatId" = ${telegramChatId}
    ORDER BY "createdAt" ASC
  `;
  const athlete = pickConnectedAthlete(rows.map(mapAthlete));

  if (athlete) {
    return athlete;
  }

  const created = await sql`
    INSERT INTO "Athlete" (
      "id", "telegramChatId", "ftpWatts", "weightKg", "createdAt", "updatedAt"
    )
    VALUES (
      ${id()}, ${telegramChatId}, ${getDefaultFtp(env)}, ${getDefaultWeightKg(env)}, ${now()}, ${now()}
    )
    RETURNING *
  `;

  return mapAthlete(created[0]);
}

export async function updateAthleteDefaults(
  env: Env,
  input: {
    telegramChatId: string;
    ftpWatts?: number;
    weightKg?: number;
  },
) {
  const updates = {
    ftpWatts: input.ftpWatts ?? null,
    weightKg: input.weightKg ?? null,
  };

  await db(env)`
    UPDATE "Athlete"
    SET
      "ftpWatts" = COALESCE(${updates.ftpWatts}, "ftpWatts"),
      "weightKg" = COALESCE(${updates.weightKg}, "weightKg"),
      "updatedAt" = ${now()}
    WHERE "telegramChatId" = ${input.telegramChatId}
  `;
}

async function mergeTelegramOnlyAthletes(
  env: Env,
  input: {
    telegramChatId: string;
    targetAthleteId: string;
  },
) {
  const sql = db(env);
  const duplicates = await sql`
    SELECT "id" FROM "Athlete"
    WHERE "telegramChatId" = ${input.telegramChatId}
      AND "stravaAthleteId" IS NULL
      AND "accessToken" IS NULL
      AND "refreshToken" IS NULL
      AND "id" <> ${input.targetAthleteId}
  `;

  for (const duplicate of duplicates) {
    const duplicateId = String(duplicate.id);

    await sql`UPDATE "Activity" SET "athleteId" = ${input.targetAthleteId}, "updatedAt" = ${now()} WHERE "athleteId" = ${duplicateId}`;
    await sql`UPDATE "AthleteNote" SET "athleteId" = ${input.targetAthleteId} WHERE "athleteId" = ${duplicateId}`;
    await sql`UPDATE "DailyHealthLog" SET "athleteId" = ${input.targetAthleteId}, "updatedAt" = ${now()} WHERE "athleteId" = ${duplicateId}`;
    await sql`DELETE FROM "Athlete" WHERE "id" = ${duplicateId}`;
  }
}

export async function storeStravaAuthorization(
  env: Env,
  input: {
    token: StravaTokenResponse;
    scope?: string;
    telegramChatId?: string;
  },
) {
  if (!input.token.athlete?.id) {
    throw new Error("Strava authorization did not return athlete id.");
  }

  const sql = db(env);
  const stravaAthleteId = BigInt(input.token.athlete.id);
  const existingByStrava = await sql`
    SELECT * FROM "Athlete" WHERE "stravaAthleteId" = ${stravaAthleteId.toString()}::bigint LIMIT 1
  `;

  if (existingByStrava.length > 0) {
    const updated = await sql`
      UPDATE "Athlete"
      SET
        "stravaScope" = ${input.scope ?? null},
        "stravaProfile" = ${toJson(input.token.athlete)}::jsonb,
        "telegramChatId" = ${input.telegramChatId ?? mapAthlete(existingByStrava[0]).telegramChatId},
        "accessToken" = ${input.token.access_token},
        "refreshToken" = ${input.token.refresh_token},
        "tokenExpiresAt" = ${new Date(input.token.expires_at * 1000).toISOString()},
        "updatedAt" = ${now()}
      WHERE "id" = ${String(existingByStrava[0].id)}
      RETURNING *
    `;
    const athlete = mapAthlete(updated[0]);

    if (input.telegramChatId) {
      await mergeTelegramOnlyAthletes(env, {
        telegramChatId: input.telegramChatId,
        targetAthleteId: athlete.id,
      });
    }

    return athlete;
  }

  if (input.telegramChatId) {
    const existingByTelegram = await sql`
      SELECT * FROM "Athlete"
      WHERE "telegramChatId" = ${input.telegramChatId}
        AND "stravaAthleteId" IS NULL
      ORDER BY "createdAt" ASC
      LIMIT 1
    `;

    if (existingByTelegram.length > 0) {
      const updated = await sql`
        UPDATE "Athlete"
        SET
          "stravaAthleteId" = ${stravaAthleteId.toString()}::bigint,
          "stravaScope" = ${input.scope ?? null},
          "stravaProfile" = ${toJson(input.token.athlete)}::jsonb,
          "accessToken" = ${input.token.access_token},
          "refreshToken" = ${input.token.refresh_token},
          "tokenExpiresAt" = ${new Date(input.token.expires_at * 1000).toISOString()},
          "updatedAt" = ${now()}
        WHERE "id" = ${String(existingByTelegram[0].id)}
        RETURNING *
      `;
      const athlete = mapAthlete(updated[0]);

      await mergeTelegramOnlyAthletes(env, {
        telegramChatId: input.telegramChatId,
        targetAthleteId: athlete.id,
      });

      return athlete;
    }
  }

  const created = await sql`
    INSERT INTO "Athlete" (
      "id", "stravaAthleteId", "stravaScope", "stravaProfile", "telegramChatId",
      "ftpWatts", "weightKg", "accessToken", "refreshToken", "tokenExpiresAt",
      "createdAt", "updatedAt"
    )
    VALUES (
      ${id()}, ${stravaAthleteId.toString()}::bigint, ${input.scope ?? null},
      ${toJson(input.token.athlete)}::jsonb, ${input.telegramChatId ?? null},
      ${getDefaultFtp(env)}, ${getDefaultWeightKg(env)}, ${input.token.access_token},
      ${input.token.refresh_token}, ${new Date(input.token.expires_at * 1000).toISOString()},
      ${now()}, ${now()}
    )
    RETURNING *
  `;
  const athlete = mapAthlete(created[0]);

  if (input.telegramChatId) {
    await mergeTelegramOnlyAthletes(env, {
      telegramChatId: input.telegramChatId,
      targetAthleteId: athlete.id,
    });
  }

  return athlete;
}

async function getPrimaryAthlete(
  env: Env,
  input?: {
    telegramChatId?: string;
    stravaAthleteId?: bigint;
  },
) {
  const sql = db(env);

  if (input?.stravaAthleteId) {
    const rows = await sql`
      SELECT * FROM "Athlete" WHERE "stravaAthleteId" = ${input.stravaAthleteId.toString()}::bigint LIMIT 1
    `;

    return rows[0] ? mapAthlete(rows[0]) : null;
  }

  if (input?.telegramChatId) {
    const rows = await sql`
      SELECT * FROM "Athlete"
      WHERE "telegramChatId" = ${input.telegramChatId}
      ORDER BY "createdAt" ASC
    `;

    return pickConnectedAthlete(rows.map(mapAthlete));
  }

  const rows = await sql`SELECT * FROM "Athlete" ORDER BY "createdAt" ASC LIMIT 1`;

  return rows[0] ? mapAthlete(rows[0]) : null;
}

async function getValidAccessToken(env: Env, athlete: Athlete) {
  if (!athlete.refreshToken) {
    throw new Error("Strava is not connected for this athlete.");
  }

  if (
    athlete.accessToken &&
    athlete.tokenExpiresAt &&
    athlete.tokenExpiresAt.getTime() - Date.now() > tokenRefreshBufferMs
  ) {
    return athlete.accessToken;
  }

  const refreshed = await refreshStravaToken(env, athlete.refreshToken);
  const sql = db(env);

  await sql`
    UPDATE "Athlete"
    SET
      "accessToken" = ${refreshed.access_token},
      "refreshToken" = ${refreshed.refresh_token},
      "tokenExpiresAt" = ${new Date(refreshed.expires_at * 1000).toISOString()},
      "updatedAt" = ${now()}
    WHERE "id" = ${athlete.id}
  `;

  return refreshed.access_token;
}

function activityStartDate(activity: StravaSummaryActivity) {
  return new Date(activity.start_date).toISOString();
}

export async function storeCalculatedActivity(
  env: Env,
  input: {
    athlete: Athlete;
    externalActivityId: bigint;
    summary: StravaSummaryActivity;
    metrics: ActivityMetrics;
    reportText: string;
    rawSummary?: unknown;
  },
) {
  const sql = db(env);
  const rows = await sql`
    INSERT INTO "Activity" (
      "id", "athleteId", "stravaActivityId", "type", "name", "startDate",
      "elapsedTimeSeconds", "movingTimeSeconds", "distanceMeters",
      "averagePowerWatts", "normalizedPowerWatts", "intensityFactor",
      "trainingStressScore", "averageHeartRate", "maxHeartRate", "rawSummary",
      "powerZoneSeconds", "reportText", "createdAt", "updatedAt"
    )
    VALUES (
      ${id()}, ${input.athlete.id}, ${input.externalActivityId.toString()}::bigint,
      ${input.summary.sport_type ?? input.summary.type}, ${input.summary.name ?? null},
      ${activityStartDate(input.summary)}, ${input.summary.elapsed_time ?? null},
      ${input.summary.moving_time ?? null}, ${input.summary.distance ?? null},
      ${input.metrics.averagePowerWatts}, ${input.metrics.normalizedPowerWatts},
      ${input.metrics.intensityFactor}, ${input.metrics.trainingStressScore},
      ${input.metrics.averageHeartRate}, ${input.metrics.maxHeartRate},
      ${toJson(input.rawSummary ?? input.summary)}::jsonb,
      ${toJson(input.metrics.powerZoneSeconds)}::jsonb,
      ${input.reportText}, ${now()}, ${now()}
    )
    ON CONFLICT ("stravaActivityId") DO UPDATE SET
      "athleteId" = EXCLUDED."athleteId",
      "type" = EXCLUDED."type",
      "name" = EXCLUDED."name",
      "startDate" = EXCLUDED."startDate",
      "elapsedTimeSeconds" = EXCLUDED."elapsedTimeSeconds",
      "movingTimeSeconds" = EXCLUDED."movingTimeSeconds",
      "distanceMeters" = EXCLUDED."distanceMeters",
      "averagePowerWatts" = EXCLUDED."averagePowerWatts",
      "normalizedPowerWatts" = EXCLUDED."normalizedPowerWatts",
      "intensityFactor" = EXCLUDED."intensityFactor",
      "trainingStressScore" = EXCLUDED."trainingStressScore",
      "averageHeartRate" = EXCLUDED."averageHeartRate",
      "maxHeartRate" = EXCLUDED."maxHeartRate",
      "rawSummary" = EXCLUDED."rawSummary",
      "powerZoneSeconds" = EXCLUDED."powerZoneSeconds",
      "reportText" = EXCLUDED."reportText",
      "updatedAt" = EXCLUDED."updatedAt"
    RETURNING *
  `;

  return mapActivity(rows[0]);
}

export async function processLatestActivity(
  env: Env,
  input?: {
    telegramChatId?: string;
    stravaAthleteId?: bigint;
  },
) {
  const athlete = await getPrimaryAthlete(env, input);

  if (!athlete) {
    return null;
  }

  const accessToken = await getValidAccessToken(env, athlete);
  const latestActivity = await fetchLatestStravaActivity(accessToken);

  if (!latestActivity) {
    return null;
  }

  const streams = await fetchStravaActivityStreams(
    accessToken,
    latestActivity.id,
  );
  const durationSeconds =
    latestActivity.moving_time ??
    latestActivity.elapsed_time ??
    streams.time?.data.at(-1) ??
    0;
  const metrics = calculateActivityMetrics({
    ftpWatts: athlete.ftpWatts,
    durationSeconds,
    watts: streams.watts?.data,
    time: streams.time?.data,
    heartrate: streams.heartrate?.data,
  });
  const reportText = buildActivityReport({
    activity: latestActivity,
    metrics,
    ftpWatts: athlete.ftpWatts,
  });
  const activity = await storeCalculatedActivity(env, {
    athlete,
    externalActivityId: BigInt(latestActivity.id),
    summary: latestActivity,
    metrics,
    reportText,
    rawSummary: latestActivity,
  });

  return { athlete, activity, metrics, reportText };
}

export async function syncRecentActivities(
  env: Env,
  input?: {
    telegramChatId?: string;
    perPage?: number;
  },
) {
  const athlete = await getPrimaryAthlete(env, {
    telegramChatId: input?.telegramChatId,
  });

  if (!athlete) {
    return [];
  }

  const accessToken = await getValidAccessToken(env, athlete);
  const summaries = await fetchStravaActivities(accessToken, {
    perPage: input?.perPage ?? 20,
  });
  const sql = db(env);

  for (const activity of summaries) {
    await sql`
      INSERT INTO "Activity" (
        "id", "athleteId", "stravaActivityId", "type", "name", "startDate",
        "elapsedTimeSeconds", "movingTimeSeconds", "distanceMeters",
        "averagePowerWatts", "normalizedPowerWatts", "averageHeartRate",
        "maxHeartRate", "rawSummary", "createdAt", "updatedAt"
      )
      VALUES (
        ${id()}, ${athlete.id}, ${BigInt(activity.id).toString()}::bigint,
        ${activity.sport_type ?? activity.type}, ${activity.name ?? null},
        ${activityStartDate(activity)}, ${activity.elapsed_time ?? null},
        ${activity.moving_time ?? null}, ${activity.distance ?? null},
        ${activity.average_watts ?? null}, ${activity.weighted_average_watts ?? null},
        ${activity.average_heartrate ?? null},
        ${activity.max_heartrate ? Math.round(activity.max_heartrate) : null},
        ${toJson(activity)}::jsonb, ${now()}, ${now()}
      )
      ON CONFLICT ("stravaActivityId") DO UPDATE SET
        "athleteId" = EXCLUDED."athleteId",
        "type" = EXCLUDED."type",
        "name" = EXCLUDED."name",
        "startDate" = EXCLUDED."startDate",
        "elapsedTimeSeconds" = EXCLUDED."elapsedTimeSeconds",
        "movingTimeSeconds" = EXCLUDED."movingTimeSeconds",
        "distanceMeters" = EXCLUDED."distanceMeters",
        "averagePowerWatts" = EXCLUDED."averagePowerWatts",
        "normalizedPowerWatts" = EXCLUDED."normalizedPowerWatts",
        "averageHeartRate" = EXCLUDED."averageHeartRate",
        "maxHeartRate" = EXCLUDED."maxHeartRate",
        "rawSummary" = EXCLUDED."rawSummary",
        "updatedAt" = EXCLUDED."updatedAt"
    `;
  }

  return summaries;
}

export async function getLatestStoredActivity(env: Env, telegramChatId?: string) {
  const athlete = await getPrimaryAthlete(env, { telegramChatId });

  if (!athlete) {
    return null;
  }

  const rows = await db(env)`
    SELECT * FROM "Activity"
    WHERE "athleteId" = ${athlete.id}
    ORDER BY "startDate" DESC
    LIMIT 1
  `;

  return rows[0] ? mapActivity(rows[0]) : null;
}

export async function getStoredActivities(
  env: Env,
  input: {
    telegramChatId: string;
    take?: number;
  },
) {
  const athlete = await getPrimaryAthlete(env, {
    telegramChatId: input.telegramChatId,
  });

  if (!athlete) {
    return [];
  }

  const rows = await db(env)`
    SELECT * FROM "Activity"
    WHERE "athleteId" = ${athlete.id}
    ORDER BY "startDate" DESC
    LIMIT ${input.take ?? 30}
  `;

  return rows.map(mapActivity);
}

export async function addAthleteNote(
  env: Env,
  input: {
    telegramChatId: string;
    text: string;
  },
) {
  const athlete = await getOrCreateTelegramAthlete(env, input.telegramChatId);
  const rows = await db(env)`
    INSERT INTO "AthleteNote" ("id", "athleteId", "text", "createdAt")
    VALUES (${id()}, ${athlete.id}, ${input.text}, ${now()})
    RETURNING *
  `;

  return mapNote(rows[0]);
}

export async function getRecentAthleteNotes(
  env: Env,
  input: {
    telegramChatId: string;
    take?: number;
  },
) {
  const athlete = await getPrimaryAthlete(env, {
    telegramChatId: input.telegramChatId,
  });

  if (!athlete) {
    return [];
  }

  const rows = await db(env)`
    SELECT * FROM "AthleteNote"
    WHERE "athleteId" = ${athlete.id}
    ORDER BY "createdAt" DESC
    LIMIT ${input.take ?? 3}
  `;

  return rows.map(mapNote);
}

function buildSummaryFromStoredActivity(activity: Activity) {
  const rawSummary =
    activity.rawSummary && typeof activity.rawSummary === "object"
      ? (activity.rawSummary as Partial<StravaSummaryActivity>)
      : {};

  return {
    ...rawSummary,
    id: Number(activity.stravaActivityId),
    type: activity.type,
    sport_type: rawSummary.sport_type ?? activity.type,
    name: activity.name ?? rawSummary.name,
    start_date: activity.startDate.toISOString(),
    elapsed_time: activity.elapsedTimeSeconds ?? rawSummary.elapsed_time,
    moving_time: activity.movingTimeSeconds ?? rawSummary.moving_time,
    distance: activity.distanceMeters ?? rawSummary.distance,
    average_watts: activity.averagePowerWatts ?? rawSummary.average_watts,
    weighted_average_watts:
      activity.normalizedPowerWatts ?? rawSummary.weighted_average_watts,
    average_heartrate:
      activity.averageHeartRate ?? rawSummary.average_heartrate,
    max_heartrate: activity.maxHeartRate ?? rawSummary.max_heartrate,
  } satisfies StravaSummaryActivity;
}

export async function ensureStoredActivityMetrics(
  env: Env,
  input: {
    telegramChatId: string;
    activityId: string;
  },
) {
  const athlete = await getPrimaryAthlete(env, {
    telegramChatId: input.telegramChatId,
  });

  if (!athlete) {
    return null;
  }

  const rows = await db(env)`
    SELECT * FROM "Activity"
    WHERE "id" = ${input.activityId} AND "athleteId" = ${athlete.id}
    LIMIT 1
  `;
  const activity = rows[0] ? mapActivity(rows[0]) : null;

  if (!activity) {
    return null;
  }

  if (
    activity.trainingStressScore !== null &&
    activity.normalizedPowerWatts !== null &&
    activity.averagePowerWatts !== null
  ) {
    return activity;
  }

  const accessToken = await getValidAccessToken(env, athlete);
  const streams = await fetchStravaActivityStreams(
    accessToken,
    Number(activity.stravaActivityId),
  );
  const durationSeconds =
    activity.movingTimeSeconds ??
    activity.elapsedTimeSeconds ??
    streams.time?.data.at(-1) ??
    0;
  const metrics = calculateActivityMetrics({
    ftpWatts: athlete.ftpWatts,
    durationSeconds,
    watts: streams.watts?.data,
    time: streams.time?.data,
    heartrate: streams.heartrate?.data,
  });
  const summary = buildSummaryFromStoredActivity(activity);
  const reportText = buildActivityReport({
    activity: summary,
    metrics,
    ftpWatts: athlete.ftpWatts,
  });

  return storeCalculatedActivity(env, {
    athlete,
    externalActivityId: activity.stravaActivityId,
    summary,
    metrics,
    reportText,
    rawSummary: activity.rawSummary ?? summary,
  });
}

export async function upsertDailyHealthLog(
  env: Env,
  input: DailyHealthImportInput,
) {
  const athlete = await getOrCreateTelegramAthlete(env, input.telegramChatId);
  const date = parseDateOnly(input.date).toISOString();
  const rows = await db(env)`
    INSERT INTO "DailyHealthLog" (
      "id", "athleteId", "date", "timezone", "activeEnergyKcal",
      "dietaryEnergyKcal", "proteinGrams", "carbsGrams", "fatGrams",
      "bodyMassKg", "sleepMinutes", "restingHeartRateBpm", "hrvMs", "steps",
      "source", "rawHealth", "createdAt", "updatedAt"
    )
    VALUES (
      ${id()}, ${athlete.id}, ${date}, ${input.timezone ?? null},
      ${optionalNumber(input.activeEnergyKcal)},
      ${optionalNumber(input.dietaryEnergyKcal)},
      ${optionalNumber(input.proteinGrams)},
      ${optionalNumber(input.carbsGrams)},
      ${optionalNumber(input.fatGrams)},
      ${optionalNumber(input.bodyMassKg)},
      ${optionalInt(input.sleepMinutes)},
      ${optionalNumber(input.restingHeartRateBpm)},
      ${optionalNumber(input.hrvMs)},
      ${optionalInt(input.steps)},
      ${input.source ?? "healthkit-ios"},
      ${input.rawHealth === undefined ? null : toJson(input.rawHealth)}::jsonb,
      ${now()}, ${now()}
    )
    ON CONFLICT ("athleteId", "date") DO UPDATE SET
      "timezone" = EXCLUDED."timezone",
      "activeEnergyKcal" = EXCLUDED."activeEnergyKcal",
      "dietaryEnergyKcal" = EXCLUDED."dietaryEnergyKcal",
      "proteinGrams" = EXCLUDED."proteinGrams",
      "carbsGrams" = EXCLUDED."carbsGrams",
      "fatGrams" = EXCLUDED."fatGrams",
      "bodyMassKg" = EXCLUDED."bodyMassKg",
      "sleepMinutes" = EXCLUDED."sleepMinutes",
      "restingHeartRateBpm" = EXCLUDED."restingHeartRateBpm",
      "hrvMs" = EXCLUDED."hrvMs",
      "steps" = EXCLUDED."steps",
      "source" = EXCLUDED."source",
      "rawHealth" = EXCLUDED."rawHealth",
      "updatedAt" = EXCLUDED."updatedAt"
    RETURNING *
  `;

  return mapHealthLog(rows[0]);
}

export async function getLatestDailyHealthLog(env: Env, telegramChatId: string) {
  const athlete = await getPrimaryAthlete(env, { telegramChatId });

  if (!athlete) {
    return null;
  }

  const rows = await db(env)`
    SELECT * FROM "DailyHealthLog"
    WHERE "athleteId" = ${athlete.id}
    ORDER BY "date" DESC
    LIMIT 1
  `;

  return rows[0] ? mapHealthLog(rows[0]) : null;
}

export async function markActivityReportSent(env: Env, activityId: string) {
  await db(env)`
    UPDATE "Activity"
    SET "reportSentAt" = ${now()}, "updatedAt" = ${now()}
    WHERE "id" = ${activityId}
  `;
}
