export type Env = {
  DATABASE_URL: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  STRAVA_REDIRECT_URI?: string;
  STRAVA_OAUTH_STATE_SECRET?: string;
  HEALTH_IMPORT_SECRET?: string;
  CRON_SECRET?: string;
  ATHLETE_DEFAULT_FTP?: string;
  ATHLETE_DEFAULT_WEIGHT_KG?: string;
  TRAINING_TIMEZONE?: string;
};

export type Athlete = {
  id: string;
  stravaAthleteId: bigint | null;
  stravaScope: string | null;
  telegramChatId: string | null;
  ftpWatts: number;
  weightKg: number | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  createdAt: Date;
};

export type Activity = {
  id: string;
  athleteId: string;
  stravaActivityId: bigint;
  type: string;
  name: string | null;
  startDate: Date;
  elapsedTimeSeconds: number | null;
  movingTimeSeconds: number | null;
  distanceMeters: number | null;
  averagePowerWatts: number | null;
  normalizedPowerWatts: number | null;
  intensityFactor: number | null;
  trainingStressScore: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  rawSummary: unknown | null;
  powerZoneSeconds: unknown | null;
  reportText: string | null;
  reportSentAt: Date | null;
  createdAt: Date;
};

export type AthleteNote = {
  id: string;
  athleteId: string;
  text: string;
  createdAt: Date;
};

export type DailyHealthLog = {
  id: string;
  athleteId: string;
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
  rawHealth?: unknown | null;
};

export type TelegramDocument = {
  file_id: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
};

export type TelegramMessage = {
  chat: {
    id: number | string;
  };
  document?: TelegramDocument;
  text?: string;
};

export type TelegramCallbackQuery = {
  id: string;
  data?: string;
  message?: {
    message_id: number;
    chat: {
      id: number | string;
    };
  };
};

export type StravaTokenResponse = {
  token_type: "Bearer";
  expires_at: number;
  expires_in: number;
  refresh_token: string;
  access_token: string;
  athlete?: {
    id: number;
    username?: string;
    firstname?: string;
    lastname?: string;
  };
};

export type StravaSummaryActivity = {
  id: number;
  name?: string;
  type: string;
  sport_type?: string;
  start_date: string;
  start_date_local?: string;
  elapsed_time?: number;
  moving_time?: number;
  distance?: number;
  average_watts?: number;
  weighted_average_watts?: number;
  average_heartrate?: number;
  max_heartrate?: number;
};

type StravaStream<T> = {
  original_size: number;
  resolution: string;
  series_type: string;
  data: T[];
};

export type StravaStreamSet = {
  time?: StravaStream<number>;
  watts?: StravaStream<number>;
  heartrate?: StravaStream<number>;
  cadence?: StravaStream<number>;
  distance?: StravaStream<number>;
};
