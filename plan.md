# Cloudflare Env

Pages 项目：thunder-fighter-helper

需要：
- REMINDERS_KV：KV binding，指向 thunder-fighter-helper
- BARK_ENDPOINT：Bark endpoint
- REMINDER_SECRET：Pages API 鉴权密钥

Cron Worker：thunder-fighter-helper-cron

需要：
- REMINDERS_KV：KV binding，指向同一个 thunder-fighter-helper
- BARK_ENDPOINT：Bark endpoint

注意：
- Pages 和 Worker 环境变量不会自动共享。
- 修改 BARK_ENDPOINT 时，两边都要手动同步。
