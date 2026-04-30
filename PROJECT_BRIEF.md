# Training Coach Bot - Project Brief

## Goal

Build a Telegram bot that automatically analyzes my cycling, running, and Hyrox training from Strava and sends blunt coach-style reports and next-day recommendations.

## Source Of Data

Zwift, Apple Watch, and other apps sync activities to Strava.

The backend reads activity data from the Strava API.

## Deployment

Vercel Functions + Neon Postgres via Vercel Marketplace.

## Bot Output Language

Russian.

## Tone

Blunt coach-like tone. Less praise, more direct critique and practical advice.

The bot should not sound like a motivational assistant. It should sound like a direct coach who cares about progress, discipline, and execution quality.

## Current Athlete Context

FTP: 285 W.

Main cycling goal: 180 km under 5 hours.

Current training focus:

- Z2 aerobic volume
- sweet spot / threshold endurance
- avoiding messy gray-zone rides
- improving discipline inside intervals

## Telegram Reports Should Include

- summary metrics
- interval detection
- power zones
- heart-rate analysis
- what was done well
- what was done badly
- what to do tomorrow
- warnings if Z2 became hidden tempo
- warnings if there were too many power spikes

## Planned Stack

- Next.js / TypeScript
- Vercel Functions
- Neon Postgres
- Prisma
- Strava API
- Telegram Bot API
- OpenAI API optional for natural-language report generation

## Product Principles

- Calculations must be deterministic.
- Numbers must not be invented by AI.
- AI may be used later only to turn already calculated facts into natural-language interpretation.
- The first useful version should be simple, reliable, and deployable.
- Reports should prioritize training usefulness over pleasant wording.
