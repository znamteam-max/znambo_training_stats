# Cloudflare Worker Migration

This folder contains the Cloudflare Worker backend that replaces the Vercel
API routes for Telegram, Strava, Health import, GPT chat, and FIT uploads.

## Cloudflare dashboard settings

Create two Worker projects from the same GitHub repository.

### Main bot

- Project name: `znambo-training-stats`
- Build command: leave empty
- Deploy command: `npx wrangler deploy --config worker/wrangler.znambo.toml`

### Wife bot

- Project name: `anfisa-training-stats`
- Build command: leave empty
- Deploy command: `npx wrangler deploy --config worker/wrangler.anfisa.toml`

## Required secrets

Add these secrets separately for each Worker:

```bash
npx wrangler secret put DATABASE_URL --config worker/wrangler.znambo.toml
npx wrangler secret put OPENAI_API_KEY --config worker/wrangler.znambo.toml
npx wrangler secret put TELEGRAM_BOT_TOKEN --config worker/wrangler.znambo.toml
npx wrangler secret put TELEGRAM_CHAT_ID --config worker/wrangler.znambo.toml
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --config worker/wrangler.znambo.toml
npx wrangler secret put STRAVA_CLIENT_ID --config worker/wrangler.znambo.toml
npx wrangler secret put STRAVA_CLIENT_SECRET --config worker/wrangler.znambo.toml
npx wrangler secret put STRAVA_REDIRECT_URI --config worker/wrangler.znambo.toml
npx wrangler secret put STRAVA_OAUTH_STATE_SECRET --config worker/wrangler.znambo.toml
npx wrangler secret put HEALTH_IMPORT_SECRET --config worker/wrangler.znambo.toml
npx wrangler secret put CRON_SECRET --config worker/wrangler.znambo.toml
```

Repeat the same commands with `worker/wrangler.anfisa.toml` and the second
bot's Telegram/Strava values.

## URLs to update

After deploy, update Strava callback URLs:

```text
https://znambo-training-stats.<workers-subdomain>.workers.dev/api/strava/callback
https://anfisa-training-stats.<workers-subdomain>.workers.dev/api/strava/callback
```

Then update Telegram webhooks:

```text
https://api.telegram.org/bot<token>/setWebhook?url=https://znambo-training-stats.<workers-subdomain>.workers.dev/api/telegram/webhook&secret_token=<telegram_webhook_secret>
https://api.telegram.org/bot<token>/setWebhook?url=https://anfisa-training-stats.<workers-subdomain>.workers.dev/api/telegram/webhook&secret_token=<telegram_webhook_secret>
```

Use `getWebhookInfo` to confirm that Telegram points to Cloudflare.
