# thunder-fighter-helper-cron

Independent Cloudflare Cron Worker for reminder delivery.

## Deploy

In Cloudflare, create a Worker named `thunder-fighter-helper-cron` and set the
root directory to `/workers/reminder-cron`.

Required bindings and vars:

- KV binding: `REMINDERS_KV`
- Cron Trigger: `* * * * *`

Local deploy from this directory:

```bash
npm install
npm run deploy
```

Before deploying with Wrangler, replace the example KV namespace id in
`wrangler.toml` with the production KV namespace id.
