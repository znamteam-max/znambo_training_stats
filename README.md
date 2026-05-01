# Training Coach Bot

Telegram bot for automatic cycling, running, and Hyrox training analysis from Strava.

The bot reads activities from Strava, calculates deterministic training metrics, and sends Russian coach-style reports with direct critique and next-day recommendations.

## Project Status

Initial planning repository.

See:

- [PROJECT_BRIEF.md](PROJECT_BRIEF.md)
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

## Planned Stack

- Next.js App Router
- TypeScript
- Vercel Functions
- Neon Postgres
- Prisma
- Strava API
- Telegram Bot API
- OpenAI API later, only for natural-language interpretation

## Phase 1 Target

Build the MVP without AI-generated reports:

- deployable Next.js app
- Prisma + Neon Postgres setup
- Strava OAuth
- latest activity and streams fetch
- deterministic metric calculations
- Telegram `/last` and `/plan` commands

## Environment

Copy `.env.example` to `.env.local` for local development and configure the same values in Vercel.

The project can build before Neon is connected, but database-backed routes require `DATABASE_URL` at runtime.

## Local Development

```bash
npm install
npm run db:generate
npm run dev
```

Useful routes:

- `GET /api/health`
- `GET /api/telegram/test`
- `GET /api/strava/auth`
- `GET /api/strava/latest`
- `GET /api/strava/webhook`
- `POST /api/strava/webhook`
- `POST /api/telegram/webhook`
- `GET /api/cron/sync`

`/api/telegram/test` requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

## Strava Connection

Create a Strava app at `https://www.strava.com/settings/api`.

Use this callback URL:

```text
https://YOUR_VERCEL_DOMAIN/api/strava/callback
```

Set these Vercel environment variables:

- `DATABASE_URL`
- `NEXT_PUBLIC_APP_URL`
- `CRON_SECRET`
- `HEALTH_IMPORT_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `STRAVA_REDIRECT_URI`
- `STRAVA_OAUTH_STATE_SECRET`
- `STRAVA_WEBHOOK_VERIFY_TOKEN`
- `OPENAI_API_KEY` for GPT chat replies in Telegram
- `OPENAI_MODEL` optional, defaults to `gpt-5-mini`

Leave `STRAVA_WEBHOOK_SIGNING_SECRET` empty unless Strava provides a webhook signing secret/header for your app.

After Neon is connected, apply the database migration:

```bash
npm run db:deploy
```

Then open:

```text
https://YOUR_VERCEL_DOMAIN/api/strava/auth
```

For Telegram-linked setup, use `/connect` in the bot and open the link it sends.

## Telegram Webhook

Set the Telegram webhook to:

```text
https://YOUR_VERCEL_DOMAIN/api/telegram/webhook
```

Use `TELEGRAM_WEBHOOK_SECRET` as the Telegram webhook secret token.

Supported commands:

- `/connect`
- `/last`
- `/plan`
- `/health`
- `/today`
- `/ask вопрос`
- `/ftp 285`
- `/weight 82`
- `/note сон 6 часов, ноги тяжёлые`

Plain text messages without a slash command are sent to the GPT chat handler
when `OPENAI_API_KEY` is configured.

## Apple Health Sync

The backend accepts daily Apple Health summaries from the companion iOS app:

```text
POST https://YOUR_VERCEL_DOMAIN/api/health/import
Authorization: Bearer HEALTH_IMPORT_SECRET
```

The iOS scaffold lives in:

```text
ios/ZnamboHealthSync
```

It reads HealthKit data from the iPhone and sends daily sleep, HRV, resting
heart rate, steps, active energy, body mass, calories, and macros to the bot.
MyFitnessPal should be linked to Apple Health first so nutrition appears in
HealthKit. After syncing, use `/health` or `/today` in Telegram.

## Strava Webhook

Use this callback URL when creating a Strava webhook subscription:

```text
https://YOUR_VERCEL_DOMAIN/api/strava/webhook
```

Use `STRAVA_WEBHOOK_VERIFY_TOKEN` as the Strava verify token.

The webhook processes new or updated Strava activities and sends the latest report to Telegram if it has not already been sent.

## Cron Fallback

`vercel.json` includes a daily fallback sync:

```text
0 4 * * *
```

Vercel sends `CRON_SECRET` as the `Authorization: Bearer ...` header for cron requests.

## Vercel

`vercel.json` pins the project to the Next.js framework preset and clears any manual static output directory override.

## First Codex Task

Read `PROJECT_BRIEF.md` and `IMPLEMENTATION_PLAN.md`.

Build Phase 1 MVP for the Training Coach Bot project using Next.js App Router, TypeScript, Prisma, Neon Postgres, Strava OAuth, and Telegram Bot API.

Do not implement AI report generation yet. First create deterministic metric calculations and a Telegram `/last` command.
