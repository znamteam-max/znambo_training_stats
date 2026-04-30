# Implementation Plan

## Phase 1 - MVP

- Create a Next.js App Router app deployable to Vercel.
- Add Neon Postgres.
- Add Prisma schema and migration flow.
- Add Telegram bot `sendMessage` test route.
- Implement Strava OAuth.
- Store athlete tokens in Postgres.
- Refresh expired Strava tokens.
- Fetch latest Strava activity.
- Fetch activity streams:
  - time
  - watts
  - heartrate
  - cadence
  - distance
- Calculate basic metrics:
  - duration
  - average power
  - normalized power
  - intensity factor
  - estimated TSS
  - average heart rate
  - max heart rate
  - power zone distribution based on FTP
- Generate deterministic Telegram report in Russian.
- Add Telegram commands:
  - `/last`
  - `/plan`

## Phase 2 - Automation

- Add Strava webhook endpoint.
- Process new activities automatically.
- Send Telegram report after each new activity.
- Add Vercel cron fallback sync.
- Avoid duplicate reports.

## Phase 3 - Coaching Logic

- Detect activity type.
- Detect intervals.
- Compare activity with previous similar sessions.
- Analyze heart-rate drift.
- Recommend next training day.
- Support manual athlete notes:
  - `/note <text>` for sleep, soreness, gym, Hyrox, fatigue, and other context
  - `/ftp 285`
  - `/weight 82`

## Phase 4 - AI Report

- Feed calculated metrics to OpenAI.
- Generate report in Russian coach style.
- Keep all numbers deterministic.
- Use AI only for interpretation, wording, and coaching narrative.

## Recommended First Implementation Task

Set up the project skeleton.

Create:

- Next.js App Router project structure
- Prisma schema
- `lib/db.ts`
- `lib/telegram.ts`
- `lib/strava.ts`
- `app/api/health/route.ts`
- `app/api/telegram/test/route.ts`
- `.env.example`
- README with setup instructions

Do not overbuild. Make it deployable to Vercel.

## Recommended Second Task

Implement Strava OAuth.

Create:

- `/api/strava/auth`
- `/api/strava/callback`
- token storage in Postgres
- token refresh helper

Use scopes:

- `read`
- `activity:read_all`

## Recommended Third Task

Implement fetching the latest Strava activity and streams.

Create:

- `/api/strava/latest`
- stream fetch for time, watts, heartrate, cadence, distance

Calculate:

- duration
- average power
- normalized power
- IF
- estimated TSS
- HR average/max
- power zone distribution based on FTP

## Recommended Fourth Task

Implement Telegram bot commands:

- `/last`
- `/plan`
- `/ftp 285`
- `/weight 82`
- `/note <text>`

For now, `/last` should fetch the latest processed activity and send a Russian coach-style deterministic report.
