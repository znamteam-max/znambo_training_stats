CREATE TABLE "DailyHealthLog" (
  "id" TEXT NOT NULL,
  "athleteId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT,
  "activeEnergyKcal" DOUBLE PRECISION,
  "dietaryEnergyKcal" DOUBLE PRECISION,
  "proteinGrams" DOUBLE PRECISION,
  "carbsGrams" DOUBLE PRECISION,
  "fatGrams" DOUBLE PRECISION,
  "bodyMassKg" DOUBLE PRECISION,
  "sleepMinutes" INTEGER,
  "restingHeartRateBpm" DOUBLE PRECISION,
  "hrvMs" DOUBLE PRECISION,
  "steps" INTEGER,
  "source" TEXT,
  "rawHealth" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DailyHealthLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyHealthLog_athleteId_date_key"
  ON "DailyHealthLog"("athleteId", "date");

CREATE INDEX "DailyHealthLog_athleteId_date_idx"
  ON "DailyHealthLog"("athleteId", "date");

ALTER TABLE "DailyHealthLog"
  ADD CONSTRAINT "DailyHealthLog_athleteId_fkey"
  FOREIGN KEY ("athleteId")
  REFERENCES "Athlete"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
