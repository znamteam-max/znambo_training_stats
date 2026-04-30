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

## First Codex Task

Read `PROJECT_BRIEF.md` and `IMPLEMENTATION_PLAN.md`.

Build Phase 1 MVP for the Training Coach Bot project using Next.js App Router, TypeScript, Prisma, Neon Postgres, Strava OAuth, and Telegram Bot API.

Do not implement AI report generation yet. First create deterministic metric calculations and a Telegram `/last` command.
