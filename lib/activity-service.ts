import { Prisma } from "@/generated/prisma/client";
import type { Athlete } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { calculateActivityMetrics } from "@/lib/metrics";
import { buildActivityReport } from "@/lib/report";
import {
  fetchStravaActivities,
  fetchLatestStravaActivity,
  fetchStravaActivityStreams,
  refreshStravaToken,
  type StravaSummaryActivity,
  type StravaTokenResponse,
} from "@/lib/strava";

const tokenRefreshBufferMs = 1000 * 60 * 5;

function pickConnectedAthlete(athletes: Athlete[]) {
  return athletes.find((athlete) => athlete.refreshToken) ?? athletes[0] ?? null;
}

function toInputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function getActivityStartDate(activity: StravaSummaryActivity) {
  return new Date(activity.start_date);
}

function getActivityTitle(activity: {
  name: string | null;
  type: string;
}) {
  return activity.name ?? activity.type;
}

function getDefaultFtp() {
  return Number(process.env.ATHLETE_DEFAULT_FTP ?? 285);
}

function getDefaultWeightKg() {
  const weight = process.env.ATHLETE_DEFAULT_WEIGHT_KG;

  return weight ? Number(weight) : null;
}

export async function getOrCreateTelegramAthlete(telegramChatId: string) {
  const db = getDb();
  const existing = await db.athlete.findMany({
    where: { telegramChatId },
    orderBy: { createdAt: "asc" },
  });
  const athlete = pickConnectedAthlete(existing);

  if (athlete) {
    return athlete;
  }

  return db.athlete.create({
    data: {
      telegramChatId,
      ftpWatts: getDefaultFtp(),
      weightKg: getDefaultWeightKg(),
    },
  });
}

async function mergeTelegramOnlyAthletes(input: {
  telegramChatId: string;
  targetAthleteId: string;
}) {
  const db = getDb();
  const duplicates = await db.athlete.findMany({
    where: {
      telegramChatId: input.telegramChatId,
      stravaAthleteId: null,
      accessToken: null,
      refreshToken: null,
      NOT: { id: input.targetAthleteId },
    },
    select: { id: true },
  });

  const duplicateIds = duplicates.map((athlete) => athlete.id);

  if (duplicateIds.length === 0) {
    return;
  }

  await db.$transaction([
    db.activity.updateMany({
      where: { athleteId: { in: duplicateIds } },
      data: { athleteId: input.targetAthleteId },
    }),
    db.athleteNote.updateMany({
      where: { athleteId: { in: duplicateIds } },
      data: { athleteId: input.targetAthleteId },
    }),
    db.athlete.deleteMany({
      where: { id: { in: duplicateIds } },
    }),
  ]);
}

export async function storeStravaAuthorization(input: {
  token: StravaTokenResponse;
  scope?: string;
  telegramChatId?: string;
}) {
  if (!input.token.athlete?.id) {
    throw new Error("Strava authorization did not return athlete id.");
  }

  const db = getDb();
  const stravaAthleteId = BigInt(input.token.athlete.id);
  const data = {
    stravaScope: input.scope,
    stravaProfile: toInputJson(input.token.athlete),
    ...(input.telegramChatId ? { telegramChatId: input.telegramChatId } : {}),
    accessToken: input.token.access_token,
    refreshToken: input.token.refresh_token,
    tokenExpiresAt: new Date(input.token.expires_at * 1000),
  };

  const existingByStrava = await db.athlete.findUnique({
    where: { stravaAthleteId },
  });

  if (existingByStrava) {
    const athlete = await db.athlete.update({
      where: { id: existingByStrava.id },
      data,
    });

    if (input.telegramChatId) {
      await mergeTelegramOnlyAthletes({
        telegramChatId: input.telegramChatId,
        targetAthleteId: athlete.id,
      });
    }

    return athlete;
  }

  if (input.telegramChatId) {
    const existingByTelegram = await db.athlete.findFirst({
      where: {
        telegramChatId: input.telegramChatId,
        stravaAthleteId: null,
      },
      orderBy: { createdAt: "asc" },
    });

    if (existingByTelegram) {
      const athlete = await db.athlete.update({
        where: { id: existingByTelegram.id },
        data: {
          stravaAthleteId,
          ...data,
        },
      });

      await mergeTelegramOnlyAthletes({
        telegramChatId: input.telegramChatId,
        targetAthleteId: athlete.id,
      });

      return athlete;
    }
  }

  const athlete = await db.athlete.create({
    data: {
      stravaAthleteId,
      ftpWatts: getDefaultFtp(),
      weightKg: getDefaultWeightKg(),
      ...data,
    },
  });

  if (input.telegramChatId) {
    await mergeTelegramOnlyAthletes({
      telegramChatId: input.telegramChatId,
      targetAthleteId: athlete.id,
    });
  }

  return athlete;
}

async function getPrimaryAthlete(input?: {
  telegramChatId?: string;
  stravaAthleteId?: bigint;
}) {
  const db = getDb();

  if (input?.stravaAthleteId) {
    const athlete = await db.athlete.findUnique({
      where: { stravaAthleteId: input.stravaAthleteId },
    });

    return athlete;
  }

  if (input?.telegramChatId) {
    const athletes = await db.athlete.findMany({
      where: { telegramChatId: input.telegramChatId },
      orderBy: { createdAt: "asc" },
    });

    return pickConnectedAthlete(athletes);
  }

  return db.athlete.findFirst({
    orderBy: { createdAt: "asc" },
  });
}

async function getValidAccessToken(athlete: Athlete) {
  const db = getDb();

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

  const refreshed = await refreshStravaToken(athlete.refreshToken);

  await db.athlete.update({
    where: { id: athlete.id },
    data: {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      tokenExpiresAt: new Date(refreshed.expires_at * 1000),
    },
  });

  return refreshed.access_token;
}

export async function processLatestActivity(input?: {
  telegramChatId?: string;
  stravaAthleteId?: bigint;
}) {
  const db = getDb();
  const athlete = await getPrimaryAthlete(input);

  if (!athlete) {
    return null;
  }

  const accessToken = await getValidAccessToken(athlete);
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

  const activity = await db.activity.upsert({
    where: { stravaActivityId: BigInt(latestActivity.id) },
    create: {
      athleteId: athlete.id,
      stravaActivityId: BigInt(latestActivity.id),
      type: latestActivity.sport_type ?? latestActivity.type,
      name: latestActivity.name,
      startDate: new Date(latestActivity.start_date),
      elapsedTimeSeconds: latestActivity.elapsed_time,
      movingTimeSeconds: latestActivity.moving_time,
      distanceMeters: latestActivity.distance,
      averagePowerWatts: metrics.averagePowerWatts,
      normalizedPowerWatts: metrics.normalizedPowerWatts,
      intensityFactor: metrics.intensityFactor,
      trainingStressScore: metrics.trainingStressScore,
      averageHeartRate: metrics.averageHeartRate,
      maxHeartRate: metrics.maxHeartRate,
      rawSummary: toInputJson(latestActivity),
      powerZoneSeconds: toInputJson(metrics.powerZoneSeconds),
      reportText,
    },
    update: {
      athleteId: athlete.id,
      type: latestActivity.sport_type ?? latestActivity.type,
      name: latestActivity.name,
      startDate: new Date(latestActivity.start_date),
      elapsedTimeSeconds: latestActivity.elapsed_time,
      movingTimeSeconds: latestActivity.moving_time,
      distanceMeters: latestActivity.distance,
      averagePowerWatts: metrics.averagePowerWatts,
      normalizedPowerWatts: metrics.normalizedPowerWatts,
      intensityFactor: metrics.intensityFactor,
      trainingStressScore: metrics.trainingStressScore,
      averageHeartRate: metrics.averageHeartRate,
      maxHeartRate: metrics.maxHeartRate,
      rawSummary: toInputJson(latestActivity),
      powerZoneSeconds: toInputJson(metrics.powerZoneSeconds),
      reportText,
    },
  });

  return {
    athlete,
    activity,
    metrics,
    reportText,
  };
}

export async function syncRecentActivities(input?: {
  telegramChatId?: string;
  perPage?: number;
}) {
  const athlete = await getPrimaryAthlete({
    telegramChatId: input?.telegramChatId,
  });

  if (!athlete) {
    return [];
  }

  const accessToken = await getValidAccessToken(athlete);
  const summaries = await fetchStravaActivities(accessToken, {
    perPage: input?.perPage ?? 20,
  });
  const db = getDb();

  for (const activity of summaries) {
    await db.activity.upsert({
      where: { stravaActivityId: BigInt(activity.id) },
      create: {
        athleteId: athlete.id,
        stravaActivityId: BigInt(activity.id),
        type: activity.sport_type ?? activity.type,
        name: activity.name,
        startDate: getActivityStartDate(activity),
        elapsedTimeSeconds: activity.elapsed_time,
        movingTimeSeconds: activity.moving_time,
        distanceMeters: activity.distance,
        averagePowerWatts: activity.average_watts,
        normalizedPowerWatts: activity.weighted_average_watts,
        averageHeartRate: activity.average_heartrate,
        maxHeartRate: activity.max_heartrate
          ? Math.round(activity.max_heartrate)
          : null,
        rawSummary: toInputJson(activity),
      },
      update: {
        athleteId: athlete.id,
        type: activity.sport_type ?? activity.type,
        name: activity.name,
        startDate: getActivityStartDate(activity),
        elapsedTimeSeconds: activity.elapsed_time,
        movingTimeSeconds: activity.moving_time,
        distanceMeters: activity.distance,
        averagePowerWatts: activity.average_watts,
        normalizedPowerWatts: activity.weighted_average_watts,
        averageHeartRate: activity.average_heartrate,
        maxHeartRate: activity.max_heartrate
          ? Math.round(activity.max_heartrate)
          : null,
        rawSummary: toInputJson(activity),
      },
    });
  }

  return summaries;
}

export async function getLatestStoredActivity(telegramChatId?: string) {
  const athlete = await getPrimaryAthlete({ telegramChatId });

  if (!athlete) {
    return null;
  }

  return getDb().activity.findFirst({
    where: { athleteId: athlete.id },
    orderBy: { startDate: "desc" },
  });
}

export async function addAthleteNote(input: {
  telegramChatId: string;
  text: string;
}) {
  const athlete = await getOrCreateTelegramAthlete(input.telegramChatId);

  return getDb().athleteNote.create({
    data: {
      athleteId: athlete.id,
      text: input.text,
    },
  });
}

export async function getRecentAthleteNotes(input: {
  telegramChatId: string;
  take?: number;
}) {
  const athlete = await getPrimaryAthlete({ telegramChatId: input.telegramChatId });

  if (!athlete) {
    return [];
  }

  return getDb().athleteNote.findMany({
    where: { athleteId: athlete.id },
    orderBy: { createdAt: "desc" },
    take: input.take ?? 3,
  });
}

export async function getStoredActivities(input: {
  telegramChatId: string;
  take?: number;
}) {
  const athlete = await getPrimaryAthlete({ telegramChatId: input.telegramChatId });

  if (!athlete) {
    return [];
  }

  return getDb().activity.findMany({
    where: { athleteId: athlete.id },
    orderBy: { startDate: "desc" },
    take: input.take ?? 30,
  });
}

export async function getStoredActivityById(input: {
  telegramChatId: string;
  activityId: string;
}) {
  const athlete = await getPrimaryAthlete({ telegramChatId: input.telegramChatId });

  if (!athlete) {
    return null;
  }

  return getDb().activity.findFirst({
    where: {
      id: input.activityId,
      athleteId: athlete.id,
    },
  });
}

function buildSummaryFromStoredActivity(activity: {
  stravaActivityId: bigint;
  type: string;
  name: string | null;
  startDate: Date;
  elapsedTimeSeconds: number | null;
  movingTimeSeconds: number | null;
  distanceMeters: number | null;
  averagePowerWatts: number | null;
  normalizedPowerWatts: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  rawSummary: Prisma.JsonValue | null;
}) {
  const rawSummary =
    activity.rawSummary && typeof activity.rawSummary === "object"
      ? (activity.rawSummary as unknown as Partial<StravaSummaryActivity>)
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

export async function ensureStoredActivityMetrics(input: {
  telegramChatId: string;
  activityId: string;
}) {
  const athlete = await getPrimaryAthlete({ telegramChatId: input.telegramChatId });

  if (!athlete) {
    return null;
  }

  const db = getDb();
  const activity = await db.activity.findFirst({
    where: {
      id: input.activityId,
      athleteId: athlete.id,
    },
  });

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

  const accessToken = await getValidAccessToken(athlete);
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

  return db.activity.update({
    where: { id: activity.id },
    data: {
      averagePowerWatts: metrics.averagePowerWatts,
      normalizedPowerWatts: metrics.normalizedPowerWatts,
      intensityFactor: metrics.intensityFactor,
      trainingStressScore: metrics.trainingStressScore,
      averageHeartRate: metrics.averageHeartRate,
      maxHeartRate: metrics.maxHeartRate,
      powerZoneSeconds: toInputJson(metrics.powerZoneSeconds),
      reportText,
    },
  });
}

export function buildStoredActivityLine(activity: {
  name: string | null;
  type: string;
  movingTimeSeconds: number | null;
  elapsedTimeSeconds: number | null;
  distanceMeters: number | null;
  averagePowerWatts: number | null;
  normalizedPowerWatts: number | null;
  intensityFactor: number | null;
  trainingStressScore: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
}) {
  const durationSeconds =
    activity.movingTimeSeconds ?? activity.elapsedTimeSeconds ?? 0;
  const minutes = Math.round(durationSeconds / 60);
  const distance = activity.distanceMeters
    ? `${(activity.distanceMeters / 1000).toFixed(1)} км`
    : "n/a";
  const tss =
    activity.trainingStressScore === null
      ? "TSS n/a"
      : `TSS ${activity.trainingStressScore.toFixed(0)}`;
  const power =
    activity.averagePowerWatts === null
      ? "avg W n/a"
      : `avg ${activity.averagePowerWatts.toFixed(0)} W`;
  const normalizedPower =
    activity.normalizedPowerWatts === null
      ? "NP n/a"
      : `NP ${activity.normalizedPowerWatts.toFixed(0)} W`;
  const intensity =
    activity.intensityFactor === null
      ? "IF n/a"
      : `IF ${activity.intensityFactor.toFixed(2)}`;
  const heartRate =
    activity.averageHeartRate === null
      ? "HR n/a"
      : `HR ${activity.averageHeartRate.toFixed(0)}${
          activity.maxHeartRate ? `/${activity.maxHeartRate}` : ""
        }`;

  return `${getActivityTitle(
    activity,
  )} · ${minutes}м · ${distance} · ${power} · ${normalizedPower} · ${intensity} · ${tss} · ${heartRate}`;
}
