import { createHash } from "node:crypto";
import { Decoder, Stream } from "@garmin/fitsdk";
import {
  addAthleteNote,
  getOrCreateTelegramAthlete,
  storeCalculatedActivity,
} from "@/lib/activity-service";
import { calculateActivityMetrics } from "@/lib/metrics";
import type { ActivityMetrics } from "@/lib/metrics";
import { buildActivityReport } from "@/lib/report";
import type { StravaSummaryActivity } from "@/lib/strava";

type FitMessage = Record<string, unknown>;
type FitMessages = Record<string, FitMessage[] | FitMessage | undefined>;

type ParsedFitActivity = {
  externalActivityId: bigint;
  summary: StravaSummaryActivity;
  metrics: ActivityMetrics;
  rawSummary: Record<string, unknown>;
  decoderErrors: string[];
};

function asArray(value: FitMessage[] | FitMessage | undefined) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getMessageList(messages: FitMessages, baseName: string) {
  const normalizedBase = normalizeKey(baseName);
  const candidates = [
    baseName,
    `${baseName}Mesg`,
    `${baseName}Mesgs`,
    `${baseName}s`,
  ].map(normalizeKey);
  const key = Object.keys(messages).find((item) => {
    const normalized = normalizeKey(item);

    return (
      candidates.includes(normalized) ||
      normalized === `${normalizedBase}mesgs`
    );
  });

  return key ? asArray(messages[key]) : [];
}

function getNumber(message: FitMessage | undefined, fields: string[]) {
  if (!message) {
    return null;
  }

  for (const field of fields) {
    const value = message[field];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function getString(message: FitMessage | undefined, fields: string[]) {
  if (!message) {
    return null;
  }

  for (const field of fields) {
    const value = message[field];

    if (typeof value === "string" && value) {
      return value;
    }
  }

  return null;
}

function getDate(message: FitMessage | undefined, fields: string[]) {
  if (!message) {
    return null;
  }

  for (const field of fields) {
    const value = message[field];

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }

    if (typeof value === "string" || typeof value === "number") {
      const date = new Date(value);

      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
  }

  return null;
}

function getFirstDate(records: FitMessage[]) {
  for (const record of records) {
    const timestamp = getDate(record, ["timestamp", "timeCreated"]);

    if (timestamp) {
      return timestamp;
    }
  }

  return null;
}

function getLastDate(records: FitMessage[]) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const timestamp = getDate(records[index], ["timestamp", "timeCreated"]);

    if (timestamp) {
      return timestamp;
    }
  }

  return null;
}

function secondsBetween(start: Date | null, end: Date | null) {
  if (!start || !end) {
    return null;
  }

  const seconds = Math.round((end.getTime() - start.getTime()) / 1000);

  return seconds > 0 ? seconds : null;
}

function buildSampleStreams(records: FitMessage[], startDate: Date) {
  const watts: number[] = [];
  const wattTimes: number[] = [];
  const heartrate: number[] = [];

  records.forEach((record, index) => {
    const timestamp = getDate(record, ["timestamp", "timeCreated"]);
    const timeSeconds = timestamp
      ? Math.max(0, Math.round((timestamp.getTime() - startDate.getTime()) / 1000))
      : index;
    const power = getNumber(record, ["power", "enhancedPower"]);
    const heartRate = getNumber(record, ["heartRate", "heart_rate"]);

    if (power !== null) {
      watts.push(power);
      wattTimes.push(timeSeconds);
    }

    if (heartRate !== null) {
      heartrate.push(heartRate);
    }
  });

  return {
    watts,
    wattTimes,
    heartrate,
  };
}

function getFileNameWithoutExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "") || fileName;
}

function normalizeSportType(input: {
  sport: string | null;
  subSport: string | null;
  fileName: string;
}) {
  const combined = `${input.sport ?? ""} ${input.subSport ?? ""} ${
    input.fileName
  }`.toLowerCase();

  if (combined.includes("run")) {
    return "Run";
  }

  if (
    combined.includes("virtual") ||
    combined.includes("indoor") ||
    combined.includes("zwift")
  ) {
    return "VirtualRide";
  }

  if (
    combined.includes("cycling") ||
    combined.includes("bike") ||
    combined.includes("biking")
  ) {
    return "Ride";
  }

  return input.sport ?? "FIT";
}

function buildExternalActivityId(input: {
  telegramChatId: string;
  fileBuffer: Buffer;
}) {
  const digest = createHash("sha256")
    .update(input.telegramChatId)
    .update(":")
    .update(input.fileBuffer)
    .digest("hex");
  const value = BigInt(`0x${digest.slice(0, 12)}`);

  return value === 0n ? -1n : -value;
}

function calculateTss(input: {
  durationSeconds: number;
  normalizedPowerWatts: number | null;
  intensityFactor: number | null;
  ftpWatts: number;
}) {
  if (
    input.normalizedPowerWatts === null ||
    input.intensityFactor === null ||
    input.durationSeconds <= 0
  ) {
    return null;
  }

  return (
    (input.durationSeconds *
      input.normalizedPowerWatts *
      input.intensityFactor) /
    (input.ftpWatts * 3600)
  ) * 100;
}

function withSessionFallbacks(input: {
  metrics: ActivityMetrics;
  session: FitMessage | undefined;
  durationSeconds: number;
  ftpWatts: number;
}) {
  const averagePowerWatts =
    input.metrics.averagePowerWatts ??
    getNumber(input.session, ["avgPower", "averagePower"]);
  const normalizedPowerWatts =
    input.metrics.normalizedPowerWatts ??
    getNumber(input.session, ["normalizedPower"]);
  const intensityFactor =
    input.metrics.intensityFactor ??
    (normalizedPowerWatts === null
      ? null
      : normalizedPowerWatts / input.ftpWatts);
  const trainingStressScore =
    input.metrics.trainingStressScore ??
    getNumber(input.session, ["trainingStressScore", "totalTrainingStressScore"]) ??
    calculateTss({
      durationSeconds: input.durationSeconds,
      normalizedPowerWatts,
      intensityFactor,
      ftpWatts: input.ftpWatts,
    });

  return {
    ...input.metrics,
    averagePowerWatts,
    normalizedPowerWatts,
    intensityFactor,
    trainingStressScore,
    averageHeartRate:
      input.metrics.averageHeartRate ??
      getNumber(input.session, ["avgHeartRate", "averageHeartRate"]),
    maxHeartRate:
      input.metrics.maxHeartRate ??
      getNumber(input.session, ["maxHeartRate", "maximumHeartRate"]),
  } satisfies ActivityMetrics;
}

function parseFitActivity(input: {
  telegramChatId: string;
  fileName: string;
  fileBuffer: Buffer;
  ftpWatts: number;
}) {
  const checkDecoder = new Decoder(Stream.fromBuffer(input.fileBuffer));

  if (!checkDecoder.isFIT()) {
    throw new Error("Это не похоже на корректный FIT-файл.");
  }

  if (!checkDecoder.checkIntegrity()) {
    throw new Error("FIT-файл не прошёл проверку целостности.");
  }

  const decoder = new Decoder(Stream.fromBuffer(input.fileBuffer));
  const { messages, errors } = decoder.read({
    applyScaleAndOffset: true,
    expandSubFields: true,
    expandComponents: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    includeUnknownData: false,
    mergeHeartRates: true,
  }) as {
    messages: FitMessages;
    errors?: unknown[];
  };
  const records = getMessageList(messages, "record");
  const sessions = getMessageList(messages, "session");
  const activities = getMessageList(messages, "activity");
  const fileIds = getMessageList(messages, "fileId");
  const sports = getMessageList(messages, "sport");
  const session = sessions[0];
  const activity = activities[0];
  const fileId = fileIds[0];
  const sportMessage = sports[0];
  const firstRecordDate = getFirstDate(records);
  const lastRecordDate = getLastDate(records);
  const startDate =
    getDate(session, ["startTime", "timestamp"]) ??
    firstRecordDate ??
    getDate(fileId, ["timeCreated", "timestamp"]) ??
    new Date();
  const rawMovingTimeSeconds =
    getNumber(session, ["totalTimerTime", "movingTime", "timerTime"]) ??
    secondsBetween(firstRecordDate, lastRecordDate) ??
    records.length;
  const movingTimeSeconds = Math.max(0, Math.round(rawMovingTimeSeconds));
  const rawElapsedTimeSeconds =
    getNumber(session, ["totalElapsedTime", "elapsedTime"]) ??
    getNumber(activity, ["totalTimerTime"]) ??
    movingTimeSeconds;
  const elapsedTimeSeconds = Math.max(0, Math.round(rawElapsedTimeSeconds));
  const sampleStreams = buildSampleStreams(records, startDate);
  const calculatedMetrics = calculateActivityMetrics({
    ftpWatts: input.ftpWatts,
    durationSeconds: movingTimeSeconds,
    watts: sampleStreams.watts,
    time: sampleStreams.wattTimes,
    heartrate: sampleStreams.heartrate,
  });
  const metrics = withSessionFallbacks({
    metrics: calculatedMetrics,
    session,
    durationSeconds: movingTimeSeconds,
    ftpWatts: input.ftpWatts,
  });
  const sport = getString(session, ["sport"]) ?? getString(sportMessage, ["sport"]);
  const subSport =
    getString(session, ["subSport"]) ?? getString(sportMessage, ["subSport"]);
  const sportType = normalizeSportType({
    sport,
    subSport,
    fileName: input.fileName,
  });
  const externalActivityId = buildExternalActivityId({
    telegramChatId: input.telegramChatId,
    fileBuffer: input.fileBuffer,
  });
  const distance =
    getNumber(session, ["totalDistance", "distance"]) ??
    getNumber(records.at(-1), ["distance"]);
  const summary = {
    id: Number(externalActivityId),
    name: getFileNameWithoutExtension(input.fileName),
    type: sportType,
    sport_type: sportType,
    start_date: startDate.toISOString(),
    start_date_local: startDate.toISOString(),
    elapsed_time: elapsedTimeSeconds,
    moving_time: movingTimeSeconds,
    distance: distance ?? undefined,
    average_watts: metrics.averagePowerWatts ?? undefined,
    weighted_average_watts: metrics.normalizedPowerWatts ?? undefined,
    average_heartrate: metrics.averageHeartRate ?? undefined,
    max_heartrate: metrics.maxHeartRate ?? undefined,
  } satisfies StravaSummaryActivity;
  const decoderErrors = (errors ?? [])
    .map((error) => String(error))
    .filter(Boolean)
    .slice(0, 5);

  return {
    externalActivityId,
    summary,
    metrics,
    decoderErrors,
    rawSummary: {
      source: "telegram_fit",
      fileName: input.fileName,
      externalActivityId: externalActivityId.toString(),
      recordCount: records.length,
      powerSampleCount: sampleStreams.watts.length,
      heartRateSampleCount: sampleStreams.heartrate.length,
      sport,
      subSport,
      session,
      activity,
      fileId,
      decoderErrors,
    },
  } satisfies ParsedFitActivity;
}

export async function importTelegramFitFile(input: {
  telegramChatId: string;
  fileName: string;
  fileBuffer: Buffer;
}) {
  const athlete = await getOrCreateTelegramAthlete(input.telegramChatId);
  const parsed = parseFitActivity({
    telegramChatId: input.telegramChatId,
    fileName: input.fileName,
    fileBuffer: input.fileBuffer,
    ftpWatts: athlete.ftpWatts,
  });
  const reportText = buildActivityReport({
    activity: parsed.summary,
    metrics: parsed.metrics,
    ftpWatts: athlete.ftpWatts,
  });
  const activity = await storeCalculatedActivity({
    athlete,
    externalActivityId: parsed.externalActivityId,
    summary: parsed.summary,
    metrics: parsed.metrics,
    reportText,
    rawSummary: parsed.rawSummary,
  });

  await addAthleteNote({
    telegramChatId: input.telegramChatId,
    text: `Загружен FIT-файл для разбора: ${input.fileName}\n${reportText}`,
  });

  return {
    activity,
    reportText,
    summary: parsed.summary,
    metrics: parsed.metrics,
    decoderErrors: parsed.decoderErrors,
  };
}
