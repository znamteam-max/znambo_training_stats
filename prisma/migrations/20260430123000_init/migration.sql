CREATE TABLE "Athlete" (
  "id" TEXT NOT NULL,
  "stravaAthleteId" BIGINT,
  "stravaScope" TEXT,
  "stravaProfile" JSONB,
  "telegramChatId" TEXT,
  "ftpWatts" INTEGER NOT NULL DEFAULT 285,
  "weightKg" DOUBLE PRECISION,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Athlete_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Activity" (
  "id" TEXT NOT NULL,
  "athleteId" TEXT NOT NULL,
  "stravaActivityId" BIGINT NOT NULL,
  "type" TEXT NOT NULL,
  "name" TEXT,
  "startDate" TIMESTAMP(3) NOT NULL,
  "elapsedTimeSeconds" INTEGER,
  "movingTimeSeconds" INTEGER,
  "distanceMeters" DOUBLE PRECISION,
  "averagePowerWatts" DOUBLE PRECISION,
  "normalizedPowerWatts" DOUBLE PRECISION,
  "intensityFactor" DOUBLE PRECISION,
  "trainingStressScore" DOUBLE PRECISION,
  "averageHeartRate" DOUBLE PRECISION,
  "maxHeartRate" INTEGER,
  "rawSummary" JSONB,
  "powerZoneSeconds" JSONB,
  "reportText" TEXT,
  "reportSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AthleteNote" (
  "id" TEXT NOT NULL,
  "athleteId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AthleteNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Athlete_stravaAthleteId_key" ON "Athlete"("stravaAthleteId");
CREATE UNIQUE INDEX "Activity_stravaActivityId_key" ON "Activity"("stravaActivityId");
CREATE INDEX "Activity_athleteId_startDate_idx" ON "Activity"("athleteId", "startDate");
CREATE INDEX "AthleteNote_athleteId_createdAt_idx" ON "AthleteNote"("athleteId", "createdAt");

ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_athleteId_fkey"
  FOREIGN KEY ("athleteId")
  REFERENCES "Athlete"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "AthleteNote"
  ADD CONSTRAINT "AthleteNote_athleteId_fkey"
  FOREIGN KEY ("athleteId")
  REFERENCES "Athlete"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
