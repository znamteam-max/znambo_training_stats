# Znambo Health Sync

Small iOS app that reads today's Apple Health / HealthKit data and sends it to
the Training Coach Bot backend.

## What It Syncs

- active energy
- steps
- sleep minutes
- resting heart rate
- HRV
- body mass
- dietary energy
- protein
- carbohydrates
- total fat

MyFitnessPal should write nutrition into Apple Health first. The app then reads
Apple Health, not MyFitnessPal directly.

## Backend Setup

Add this env var to the matching Vercel project:

```text
HEALTH_IMPORT_SECRET=<random-secret>
```

Use the same value in the iOS app settings screen.

The backend endpoint is:

```text
POST https://YOUR_VERCEL_DOMAIN/api/health/import
Authorization: Bearer <HEALTH_IMPORT_SECRET>
```

## Xcode Setup

1. On a Mac, install Xcode.
2. Create a new iOS App project named `ZnamboHealthSync`.
3. Copy the files from `Sources/` into the app target.
4. Copy `Info.plist` values into the target Info settings.
5. Enable **Signing & Capabilities -> HealthKit**.
6. Set a unique bundle id, for example:

```text
app.znambo.healthsync
```

7. Run on a real iPhone. HealthKit does not work fully in a simulator.

If you use XcodeGen, this folder also includes `project.yml`.

## App Settings

In the app, enter:

```text
API Base URL: https://znambo-training-stats.vercel.app
Telegram Chat ID: 52203584
Import Secret: same as HEALTH_IMPORT_SECRET
```

Then:

1. Tap **Request Apple Health Access**.
2. Allow all requested data types.
3. Tap **Sync Today**.
4. In Telegram, send `/health` or `/today`.
