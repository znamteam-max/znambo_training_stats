export type PowerZoneKey = "z1" | "z2" | "z3" | "z4" | "z5" | "z6" | "z7";

export type PowerZoneDistribution = Record<PowerZoneKey, number>;

export type ActivityMetrics = {
  durationSeconds: number;
  averagePowerWatts: number | null;
  normalizedPowerWatts: number | null;
  intensityFactor: number | null;
  trainingStressScore: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  powerZoneSeconds: PowerZoneDistribution;
  spikeCount: number;
  warnings: string[];
};

type CalculateActivityMetricsInput = {
  ftpWatts: number;
  durationSeconds: number;
  watts?: number[];
  time?: number[];
  heartrate?: number[];
};

const emptyPowerZones: PowerZoneDistribution = {
  z1: 0,
  z2: 0,
  z3: 0,
  z4: 0,
  z5: 0,
  z6: 0,
  z7: 0,
};

function cleanNumbers(values?: number[]) {
  return (values ?? []).filter((value) => Number.isFinite(value));
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getSampleDuration(index: number, time?: number[]) {
  if (!time || time.length < 2) {
    return 1;
  }

  const current = time[index];
  const next = time[index + 1];

  if (Number.isFinite(current) && Number.isFinite(next) && next > current) {
    return next - current;
  }

  return 1;
}

function getPowerZone(power: number, ftpWatts: number): PowerZoneKey {
  const ratio = power / ftpWatts;

  if (ratio <= 0.55) return "z1";
  if (ratio <= 0.75) return "z2";
  if (ratio <= 0.9) return "z3";
  if (ratio <= 1.05) return "z4";
  if (ratio <= 1.2) return "z5";
  if (ratio <= 1.5) return "z6";
  return "z7";
}

function calculatePowerZones(
  watts: number[],
  ftpWatts: number,
  time?: number[],
) {
  const zones = { ...emptyPowerZones };

  watts.forEach((power, index) => {
    zones[getPowerZone(power, ftpWatts)] += getSampleDuration(index, time);
  });

  return zones;
}

function calculateNormalizedPower(watts: number[]) {
  if (watts.length === 0) {
    return null;
  }

  const rollingWindowSeconds = 30;
  const rollingAverages: number[] = [];

  for (let index = 0; index < watts.length; index += 1) {
    const start = Math.max(0, index - rollingWindowSeconds + 1);
    const window = watts.slice(start, index + 1);
    const windowAverage = average(window);

    if (windowAverage !== null) {
      rollingAverages.push(windowAverage);
    }
  }

  const fourthPowerAverage = average(
    rollingAverages.map((value) => value ** 4),
  );

  return fourthPowerAverage === null ? null : fourthPowerAverage ** 0.25;
}

function buildWarnings(input: {
  durationSeconds: number;
  powerZoneSeconds: PowerZoneDistribution;
  spikeCount: number;
}) {
  const warnings: string[] = [];
  const duration = Math.max(input.durationSeconds, 1);
  const tempoShare =
    (input.powerZoneSeconds.z3 + input.powerZoneSeconds.z4) / duration;
  const spikeShare =
    (input.powerZoneSeconds.z6 + input.powerZoneSeconds.z7) / duration;

  if (duration >= 45 * 60 && tempoShare > 0.2) {
    warnings.push(
      "Похоже на скрытый темп: слишком много времени в Z3/Z4 для спокойной работы.",
    );
  }

  if (input.spikeCount > 20 || spikeShare > 0.04) {
    warnings.push(
      "Слишком много всплесков мощности. Для базы это мусорная работа, не дисциплина.",
    );
  }

  return warnings;
}

export function calculateActivityMetrics(input: CalculateActivityMetricsInput) {
  const watts = cleanNumbers(input.watts);
  const heartrate = cleanNumbers(input.heartrate);
  const averagePowerWatts = average(watts);
  const normalizedPowerWatts = calculateNormalizedPower(watts);
  const intensityFactor =
    normalizedPowerWatts === null
      ? null
      : normalizedPowerWatts / input.ftpWatts;
  const trainingStressScore =
    normalizedPowerWatts === null || intensityFactor === null
      ? null
      : ((input.durationSeconds * normalizedPowerWatts * intensityFactor) /
          (input.ftpWatts * 3600)) *
        100;
  const powerZoneSeconds = calculatePowerZones(
    watts,
    input.ftpWatts,
    input.time,
  );
  const spikeCount = watts.filter((value) => value > input.ftpWatts * 1.5)
    .length;

  return {
    durationSeconds: input.durationSeconds,
    averagePowerWatts,
    normalizedPowerWatts,
    intensityFactor,
    trainingStressScore,
    averageHeartRate: average(heartrate),
    maxHeartRate: heartrate.length > 0 ? Math.max(...heartrate) : null,
    powerZoneSeconds,
    spikeCount,
    warnings: buildWarnings({
      durationSeconds: input.durationSeconds,
      powerZoneSeconds,
      spikeCount,
    }),
  } satisfies ActivityMetrics;
}
