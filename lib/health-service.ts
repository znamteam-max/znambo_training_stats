import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { getOrCreateTelegramAthlete } from "@/lib/activity-service";

export type DailyHealthImportInput = {
  telegramChatId: string;
  date: string;
  timezone?: string;
  activeEnergyKcal?: number | null;
  dietaryEnergyKcal?: number | null;
  proteinGrams?: number | null;
  carbsGrams?: number | null;
  fatGrams?: number | null;
  bodyMassKg?: number | null;
  sleepMinutes?: number | null;
  restingHeartRateBpm?: number | null;
  hrvMs?: number | null;
  steps?: number | null;
  source?: string;
  rawHealth?: unknown;
};

type DailyHealthLogSummary = {
  date: Date;
  timezone: string | null;
  activeEnergyKcal: number | null;
  dietaryEnergyKcal: number | null;
  proteinGrams: number | null;
  carbsGrams: number | null;
  fatGrams: number | null;
  bodyMassKg: number | null;
  sleepMinutes: number | null;
  restingHeartRateBpm: number | null;
  hrvMs: number | null;
  steps: number | null;
  source: string | null;
};

function toInputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parseDateOnly(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("date must be in YYYY-MM-DD format.");
  }

  return new Date(`${date}T00:00:00.000Z`);
}

function optionalNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Number.isFinite(value)) {
    throw new Error("Health payload contains a non-finite number.");
  }

  return value;
}

function optionalInt(value: number | null | undefined) {
  const number = optionalNumber(value);

  return number === null ? null : Math.round(number);
}

function round(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }

  return value.toFixed(digits);
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatSleep(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) {
    return "n/a";
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return `${hours}ч ${rest}м`;
}

function formatNutrition(log: DailyHealthLogSummary) {
  if (
    log.dietaryEnergyKcal === null &&
    log.proteinGrams === null &&
    log.carbsGrams === null &&
    log.fatGrams === null
  ) {
    return "Питание: n/a";
  }

  return [
    `Питание: ${round(log.dietaryEnergyKcal)} ккал.`,
    `БЖУ: белок ${round(log.proteinGrams)} г, углеводы ${round(
      log.carbsGrams,
    )} г, жиры ${round(log.fatGrams)} г.`,
  ].join("\n");
}

export async function upsertDailyHealthLog(input: DailyHealthImportInput) {
  const athlete = await getOrCreateTelegramAthlete(input.telegramChatId);
  const date = parseDateOnly(input.date);

  return getDb().dailyHealthLog.upsert({
    where: {
      athleteId_date: {
        athleteId: athlete.id,
        date,
      },
    },
    create: {
      athleteId: athlete.id,
      date,
      timezone: input.timezone,
      activeEnergyKcal: optionalNumber(input.activeEnergyKcal),
      dietaryEnergyKcal: optionalNumber(input.dietaryEnergyKcal),
      proteinGrams: optionalNumber(input.proteinGrams),
      carbsGrams: optionalNumber(input.carbsGrams),
      fatGrams: optionalNumber(input.fatGrams),
      bodyMassKg: optionalNumber(input.bodyMassKg),
      sleepMinutes: optionalInt(input.sleepMinutes),
      restingHeartRateBpm: optionalNumber(input.restingHeartRateBpm),
      hrvMs: optionalNumber(input.hrvMs),
      steps: optionalInt(input.steps),
      source: input.source ?? "healthkit-ios",
      rawHealth: input.rawHealth === undefined ? undefined : toInputJson(input.rawHealth),
    },
    update: {
      timezone: input.timezone,
      activeEnergyKcal: optionalNumber(input.activeEnergyKcal),
      dietaryEnergyKcal: optionalNumber(input.dietaryEnergyKcal),
      proteinGrams: optionalNumber(input.proteinGrams),
      carbsGrams: optionalNumber(input.carbsGrams),
      fatGrams: optionalNumber(input.fatGrams),
      bodyMassKg: optionalNumber(input.bodyMassKg),
      sleepMinutes: optionalInt(input.sleepMinutes),
      restingHeartRateBpm: optionalNumber(input.restingHeartRateBpm),
      hrvMs: optionalNumber(input.hrvMs),
      steps: optionalInt(input.steps),
      source: input.source ?? "healthkit-ios",
      rawHealth: input.rawHealth === undefined ? undefined : toInputJson(input.rawHealth),
    },
  });
}

export async function getLatestDailyHealthLog(telegramChatId: string) {
  const athlete = await getOrCreateTelegramAthlete(telegramChatId);

  return getDb().dailyHealthLog.findFirst({
    where: { athleteId: athlete.id },
    orderBy: { date: "desc" },
  });
}

export function buildDailyHealthSummary(log: DailyHealthLogSummary | null) {
  if (!log) {
    return "Данных Apple Health пока нет. Открой Znambo Health Sync на iPhone и нажми Sync Today.";
  }

  return [
    `Health-сводка за ${formatDate(log.date)}`,
    "",
    formatNutrition(log),
    "",
    `Сон: ${formatSleep(log.sleepMinutes)}.`,
    `Вес: ${round(log.bodyMassKg, 1)} кг.`,
    `Шаги: ${round(log.steps)}.`,
    `Активная энергия: ${round(log.activeEnergyKcal)} ккал.`,
    `Пульс покоя: ${round(log.restingHeartRateBpm)} bpm.`,
    `HRV: ${round(log.hrvMs)} ms.`,
    "",
    `Источник: ${log.source ?? "n/a"}.`,
  ].join("\n");
}

export function buildDailyHealthContext(log: DailyHealthLogSummary | null) {
  if (!log) {
    return null;
  }

  return [
    `Дата: ${formatDate(log.date)}`,
    `Питание: ${round(log.dietaryEnergyKcal)} ккал; белок ${round(
      log.proteinGrams,
    )} г; углеводы ${round(log.carbsGrams)} г; жиры ${round(log.fatGrams)} г.`,
    `Сон: ${formatSleep(log.sleepMinutes)}.`,
    `Вес: ${round(log.bodyMassKg, 1)} кг.`,
    `Шаги: ${round(log.steps)}.`,
    `Активная энергия: ${round(log.activeEnergyKcal)} ккал.`,
    `Пульс покоя: ${round(log.restingHeartRateBpm)} bpm.`,
    `HRV: ${round(log.hrvMs)} ms.`,
  ].join("\n");
}
