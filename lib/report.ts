import type { ActivityMetrics, PowerZoneDistribution } from "@/lib/metrics";
import type { StravaSummaryActivity } from "@/lib/strava";

type StoredActivityForPlan = {
  intensityFactor: number | null;
  trainingStressScore: number | null;
  averagePowerWatts: number | null;
  normalizedPowerWatts: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  type: string;
  name: string | null;
};

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

function formatDistance(meters?: number) {
  if (!meters) {
    return "n/a";
  }

  return `${(meters / 1000).toFixed(1)} км`;
}

function formatZones(zones: PowerZoneDistribution) {
  return [
    `Z1 ${Math.round(zones.z1 / 60)}м`,
    `Z2 ${Math.round(zones.z2 / 60)}м`,
    `Z3 ${Math.round(zones.z3 / 60)}м`,
    `Z4 ${Math.round(zones.z4 / 60)}м`,
    `Z5 ${Math.round(zones.z5 / 60)}м`,
    `Z6 ${Math.round(zones.z6 / 60)}м`,
    `Z7 ${Math.round(zones.z7 / 60)}м`,
  ].join(", ");
}

function buildGood(metrics: ActivityMetrics) {
  const z2Minutes = Math.round(metrics.powerZoneSeconds.z2 / 60);

  if (z2Minutes >= 30 && metrics.warnings.length === 0) {
    return `Хорошо: есть ${z2Minutes} минут в Z2 без явного развала по зонам.`;
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

export function buildActivityReport(input: {
  activity: StravaSummaryActivity;
  metrics: ActivityMetrics;
  ftpWatts: number;
}) {
  const { activity, metrics, ftpWatts } = input;

  return [
    `Разбор тренировки: ${activity.name ?? activity.type}`,
    "",
    `Итог: ${formatDuration(metrics.durationSeconds)}, ${formatDistance(
      activity.distance,
    )}, тип ${activity.type}.`,
    `Мощность: avg ${round(metrics.averagePowerWatts)} W, NP ${round(
      metrics.normalizedPowerWatts,
    )} W, IF ${round(metrics.intensityFactor, 2)}, TSS ${round(
      metrics.trainingStressScore,
    )}. FTP ${ftpWatts} W.`,
    `Пульс: avg ${round(metrics.averageHeartRate)}, max ${round(
      metrics.maxHeartRate,
    )}.`,
    `Зоны мощности: ${formatZones(metrics.powerZoneSeconds)}.`,
    "",
    buildGood(metrics),
    buildBad(metrics),
    "",
    buildNextDayPlanFromMetrics(metrics),
  ].join("\n");
}

export function buildNextDayPlanFromMetrics(metrics: ActivityMetrics) {
  const tss = metrics.trainingStressScore ?? 0;
  const intensityFactor = metrics.intensityFactor ?? 0;

  if (tss >= 90 || intensityFactor >= 0.86) {
    return "Завтра: 45-75 минут Z1/Z2 без героизма. Если ноги деревянные - отдых. Интервалы не трогать.";
  }

  if (tss >= 50 || intensityFactor >= 0.75) {
    return "Завтра: ровная Z2 60-90 минут. Держать мощность спокойно, без заездов в серую зону.";
  }

  return "Завтра: можно делать качественную работу: sweet spot 2x20 или Z2 90-120 минут, но без хаоса по мощности.";
}

export function buildPlanFromStoredActivity(activity: StoredActivityForPlan) {
  const tss = activity.trainingStressScore ?? 0;
  const intensityFactor = activity.intensityFactor ?? 0;

  if (tss >= 90 || intensityFactor >= 0.86) {
    return "План на завтра: восстановление. 45-75 минут очень спокойно или полный отдых. После такой нагрузки не надо доказывать характер.";
  }

  if (tss >= 50 || intensityFactor >= 0.75) {
    return "План на завтра: Z2 60-90 минут. Ровно, скучно, дисциплинированно. Никаких случайных гонок.";
  }

  return "План на завтра: если самочувствие нормальное, делай sweet spot 2x20 или Z2 90-120 минут. Главная задача - держать заданную мощность, а не устраивать кашу.";
}
