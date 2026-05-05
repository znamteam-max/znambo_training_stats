import type { Activity } from "./types";
import type { ActivityMetrics, PowerZoneDistribution } from "./metrics";
import type { StravaSummaryActivity } from "./types";

function round(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }

  return value.toFixed(digits);
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}ч ${minutes}м`;
  }

  return `${minutes}м`;
}

function formatDistance(meters?: number | null) {
  if (!meters) {
    return "n/a";
  }

  return `${(meters / 1000).toFixed(1)} км`;
}

function formatZoneDetails(zones: PowerZoneDistribution, durationSeconds: number) {
  const duration = Math.max(durationSeconds, 1);

  return [
    ["Z1", zones.z1, "восстановление"],
    ["Z2", zones.z2, "аэробная база"],
    ["Z3", zones.z3, "темпо"],
    ["Z4", zones.z4, "порог"],
    ["Z5", zones.z5, "VO2"],
    ["Z6", zones.z6, "анаэробная"],
    ["Z7", zones.z7, "спринт"],
  ]
    .map(([label, seconds, description]) => {
      const minutes = Math.round(Number(seconds) / 60);
      const share = Math.round((Number(seconds) / duration) * 100);

      return `${label}: ${minutes}м (${share}%) - ${description}`;
    })
    .join("\n");
}

function formatVariability(metrics: ActivityMetrics) {
  if (
    metrics.averagePowerWatts === null ||
    metrics.normalizedPowerWatts === null ||
    metrics.averagePowerWatts === 0
  ) {
    return "n/a";
  }

  return round(metrics.normalizedPowerWatts / metrics.averagePowerWatts, 2);
}

function buildWorkoutRead(metrics: ActivityMetrics) {
  const tss = metrics.trainingStressScore ?? 0;
  const intensityFactor = metrics.intensityFactor ?? 0;
  const z2Minutes = Math.round(metrics.powerZoneSeconds.z2 / 60);
  const highIntensityMinutes = Math.round(
    (metrics.powerZoneSeconds.z5 +
      metrics.powerZoneSeconds.z6 +
      metrics.powerZoneSeconds.z7) /
      60,
  );

  if (tss >= 90 || intensityFactor >= 0.86) {
    return "Это уже серьёзная нагрузка: организм получил не просто объём, а заметный стресс. После такого качество следующей тренировки зависит от восстановления, сна и питания.";
  }

  if (highIntensityMinutes >= 8) {
    return `Тренировка смешанная: база есть, но ${highIntensityMinutes} минут в верхних зонах добавили нервной системы и мышечного стресса. Это не чистая лёгкая поездка.`;
  }

  if (z2Minutes >= 45 && intensityFactor < 0.75) {
    return "По профилю это аккуратная аэробная работа. Хороший кирпичик в базу: достаточно долго, без лишней драки с мощностью.";
  }

  if (tss < 50 && intensityFactor < 0.7) {
    return "Нагрузка умеренная. Такая тренировка больше поддерживает форму и кровоток, чем развивает потолок мощности.";
  }

  return "Нагрузка средняя: полезная работа есть, но без явного выхода в тяжёлую тренировку. Тут важнее регулярность, чем героизм.";
}

function buildGood(metrics: ActivityMetrics) {
  const z2Minutes = Math.round(metrics.powerZoneSeconds.z2 / 60);

  if (z2Minutes >= 30 && metrics.warnings.length === 0) {
    return `Хорошо: ${z2Minutes} минут в Z2 - это нормальный аэробный объём. Для базы такая работа ценнее, чем случайные ускорения ради красивых цифр.`;
  }

  if (
    metrics.normalizedPowerWatts !== null &&
    metrics.averagePowerWatts !== null &&
    metrics.normalizedPowerWatts - metrics.averagePowerWatts < 20
  ) {
    return "Хорошо: мощность относительно ровная, без большого разрыва между NP и средней.";
  }

  return "Хорошо: тренировка записана, данные есть. Теперь надо смотреть качество исполнения.";
}

function buildBad(metrics: ActivityMetrics) {
  if (metrics.warnings.length > 0) {
    return `Плохо: ${metrics.warnings.join(" ")}`;
  }

  if (metrics.averagePowerWatts === null) {
    return "Плохо: нет потока мощности. Для велоанализа это почти слепой режим.";
  }

  return "Плохо: пока мало контекста по цели тренировки, поэтому нельзя честно оценить попадание в задание.";
}

function buildCoachNotes(metrics: ActivityMetrics) {
  const notes = [
    buildGood(metrics),
    buildBad(metrics),
    `Ровность: VI ${formatVariability(metrics)}. Чем ближе к 1.00, тем спокойнее и чище выполнена работа.`,
  ];

  if (metrics.spikeCount > 0) {
    notes.push(
      `Всплески: ${metrics.spikeCount}. Если это была база, такие пики лучше убирать; если интервалы - ок, но тогда нужна структура.`,
    );
  }

  if (metrics.averageHeartRate !== null && metrics.maxHeartRate !== null) {
    notes.push(
      `Пульс: средний ${round(metrics.averageHeartRate)}, максимум ${round(
        metrics.maxHeartRate,
      )}. Без твоих зон ЧСС это не диагноз, но маркер нагрузки уже полезный.`,
    );
  }

  return notes.join("\n");
}

export function buildActivityReport(input: {
  activity: StravaSummaryActivity;
  metrics: ActivityMetrics;
  ftpWatts: number;
}) {
  const { activity, metrics, ftpWatts } = input;

  return [
    `Разбор тренировки: ${activity.name ?? activity.type}`,
    "",
    "1. Коротко",
    `Длительность: ${formatDuration(metrics.durationSeconds)}.`,
    `Дистанция: ${formatDistance(activity.distance)}.`,
    `Тип: ${activity.sport_type ?? activity.type}.`,
    `FTP для расчёта: ${ftpWatts} W.`,
    "",
    "2. Основные цифры",
    `Мощность: avg ${round(metrics.averagePowerWatts)} W, NP ${round(
      metrics.normalizedPowerWatts,
    )} W, VI ${formatVariability(metrics)}.`,
    `Интенсивность: IF ${round(metrics.intensityFactor, 2)}, TSS ${round(
      metrics.trainingStressScore,
    )}.`,
    `Пульс: avg ${round(metrics.averageHeartRate)}, max ${round(
      metrics.maxHeartRate,
    )}.`,
    "",
    "3. Что это значит",
    buildWorkoutRead(metrics),
    "",
    "4. Зоны мощности",
    formatZoneDetails(metrics.powerZoneSeconds, metrics.durationSeconds),
    "",
    "5. Тренерский вывод",
    buildCoachNotes(metrics),
    "",
    "6. План на завтра",
    buildNextDayPlanFromMetrics(metrics),
  ].join("\n");
}

export function buildNextDayPlanFromMetrics(metrics: ActivityMetrics) {
  const tss = metrics.trainingStressScore ?? 0;
  const intensityFactor = metrics.intensityFactor ?? 0;
  const z2Minutes = Math.round(metrics.powerZoneSeconds.z2 / 60);

  if (tss >= 90 || intensityFactor >= 0.86) {
    return [
      "Восстановление. 45-75 минут Z1/Z2 или полный отдых, если ноги тяжёлые.",
      "Цель: убрать усталость, а не заработать новый стресс.",
      "Запрет: порог, VO2, случайные зарубы и проверка характера.",
    ].join("\n");
  }

  if (tss >= 50 || intensityFactor >= 0.75) {
    return [
      "Ровная Z2 60-90 минут.",
      "Держи мощность спокойно, без заездов в серую зону.",
      "Если пульс выше обычного на той же мощности - сокращай до 45-60 минут.",
    ].join("\n");
  }

  if (z2Minutes >= 45) {
    return [
      "Можно делать качественную работу, если самочувствие нормальное.",
      "Вариант 1: sweet spot 2x20 минут.",
      "Вариант 2: Z2 90-120 минут ровно и без хаоса.",
    ].join("\n");
  }

  return [
    "Нагрузка была лёгкая, завтра можно выбирать по самочувствию.",
    "Если хочется структуры: Z2 75-105 минут.",
    "Если хочется качества: sweet spot 3x12 минут, но только без забивания ног.",
  ].join("\n");
}

export function buildPlanFromStoredActivity(activity: Activity) {
  const tss = activity.trainingStressScore ?? 0;
  const intensityFactor = activity.intensityFactor ?? 0;

  if (tss >= 90 || intensityFactor >= 0.86) {
    return [
      "План на завтра: восстановление.",
      "45-75 минут очень спокойно или полный отдых.",
      "После такой нагрузки не надо доказывать характер: задача - выйти свежим на следующую качественную работу.",
    ].join("\n");
  }

  if (tss >= 50 || intensityFactor >= 0.75) {
    return [
      "План на завтра: Z2 60-90 минут.",
      "Ровно, скучно, дисциплинированно.",
      "Никаких случайных гонок. Если пульс ползёт вверх - заканчивай раньше.",
    ].join("\n");
  }

  return [
    "План на завтра: если самочувствие нормальное, делай sweet spot 2x20 или Z2 90-120 минут.",
    "Главная задача - держать заданную мощность, а не устраивать кашу.",
    `Контекст последней тренировки: ${activity.name ?? activity.type}, IF ${round(
      activity.intensityFactor,
      2,
    )}, TSS ${round(activity.trainingStressScore)}.`,
  ].join("\n");
}
