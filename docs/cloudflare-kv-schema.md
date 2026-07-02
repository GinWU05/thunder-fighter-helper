# Cloudflare KV Schema

本文档记录生产 KV `REMINDERS_KV` 的 key/value 结构。它是开发和排查用的 schema 说明，不是 SQL schema。

## Namespace

| 名称 | 说明 |
|---|---|
| `REMINDERS_KV` | Pages Functions 和 Cron Worker 共用的 Cloudflare KV namespace |

## Key 总览

| Key | Value 类型 | 中文说明 | 写入方 | 读取方 | 删除方 |
|---|---|---|---|---|---|
| `username:{username}` | string | username 占用关系，value 是 `userId` | Pages API 注册 | Pages API 鉴权 | Pages API 解绑 |
| `user:{userId}:profile` | JSON | 用户资料，保存 `ownerTokenHash`，不保存明文 ownerToken | Pages API 注册 | Pages API 鉴权 | Pages API 解绑 |
| `user:{userId}:webpush` | JSON | 用户 Web Push subscription id 索引 | Pages API 订阅/取消订阅 | Pages API 创建提醒、Cron Worker 到期发送 | Pages API 取消订阅/解绑 |
| `webpush:{userId}:{subscriptionId}` | JSON | 单个浏览器/设备的 Web Push subscription | Pages API 订阅 | Pages API 测试通知、Cron Worker 到期发送 | Pages API 取消订阅、Cron Worker 清理失效订阅 |
| `reminder:{dueAtIso}:{userId}:{uuid}` | JSON | 待触发提醒 | Pages API 创建提醒 | Pages API 列表/取消、Cron Worker 到期读取 | Pages API 取消、Cron Worker 成功发送 |
| `failed:{dueAtIso}:{userId}:{uuid}` | JSON | 失败 3 次后的提醒归档 | Cron Worker | 人工排查 | 人工清理 |
| `scheduler:nextDueAt` | JSON | 调度游标，记录待处理分钟队列和下一批到期分钟，避免 Cron 全量 list | Pages API 创建提醒、Cron Worker 更新 | Cron Worker | Cron Worker |
| `scheduler:due:{minuteIso}` | JSON | 分钟 bucket，记录某一分钟需要处理的 reminder key 列表 | Pages API 创建提醒、Cron Worker 写回重试项 | Cron Worker | Cron Worker |

## `username:{username}`

username 占用关系，用于保证 username 不重复，并根据 username 找到对应 `userId`。

```txt
key: username:ginwu_pc_chrome
value: 0ed74018-6565-4aa8-8b16-f26e1c06868d
```

Value 是纯字符串，不是 JSON。

## `user:{userId}:profile`

用户资料。Pages API 校验 ownerToken 时会读取这个 key。

```txt
key: user:0ed74018-6565-4aa8-8b16-f26e1c06868d:profile
```

```json
{
  "userId": "0ed74018-6565-4aa8-8b16-f26e1c06868d",
  "username": "ginwu_pc_chrome",
  "ownerTokenHash": "sha256_hex",
  "createdAtIso": "2026-06-29T14:20:51.944Z"
}
```

字段说明：

| 字段 | 类型 | 中文说明 |
|---|---|---|
| `userId` | string | 用户 UUID |
| `username` | string | 用户名 |
| `ownerTokenHash` | string | `REMINDER_SECRET + ownerToken` 的 SHA-256 hex，用于 owner 校验 |
| `createdAtIso` | string | 创建时间，UTC ISO 字符串 |

注意：明文 `ownerToken` 只返回给前端并保存在浏览器 localStorage，KV 只保存 hash。

## `reminder:{dueAtIso}:{userId}:{uuid}`

待触发提醒。Pages API 创建，Cron Worker 到期时按 `scheduler:nextDueAt` 指向的 bucket 读取。

```txt
key: reminder:2026-06-29T15:11:57.014Z:0ed74018-6565-4aa8-8b16-f26e1c06868d:49b49a98-f134-4c9d-a56a-e11d4186c14f
```

```json
{
  "id": "49b49a98-f134-4c9d-a56a-e11d4186c14f",
  "userId": "0ed74018-6565-4aa8-8b16-f26e1c06868d",
  "username": "ginwu_pc_chrome",
  "barkUrl": "https://api.day.app/YOUR_KEY/",
  "title": "雷霆战机提醒",
  "message": "体力快满了",
  "dueAtIso": "2026-06-29T15:11:57.014Z",
  "retryCount": 0,
  "createdAtIso": "2026-06-29T15:10:57.230Z",
  "channels": ["bark", "webpush"],
  "webPushSubscriptionIds": ["sha256_endpoint_prefix"],
  "delivery": {
    "barkSentAtIso": "2026-06-29T15:11:58.014Z",
    "webPushSentAtIso": "2026-06-29T15:11:58.014Z",
    "webPushFailedSubscriptionIds": []
  }
}
```

字段说明：

| 字段 | 类型 | 中文说明 |
|---|---|---|
| `id` | string | reminder UUID |
| `userId` | string | 所属用户 UUID |
| `username` | string | 所属 username，便于人工排查 |
| `barkUrl` | string | Bark base URL，例如 `https://api.day.app/YOUR_KEY/` |
| `title` | string | Bark 通知标题 |
| `message` | string | Bark 通知正文 |
| `dueAtIso` | string | 到期时间，UTC ISO 字符串 |
| `retryCount` | number | 已重试次数 |
| `createdAtIso` | string | 创建时间，UTC ISO 字符串 |
| `channels` | string[] | 可选，新提醒使用的通道：`bark`、`webpush`；旧数据缺省时按 Bark-only 处理 |
| `webPushSubscriptionIds` | string[] | 可选，Web Push 目标 subscription id 列表 |
| `delivery` | object | 可选，记录每个通道是否已成功发送，避免重试时重复发送 |
| `lastError` | string | 可选，失败后记录最后一次错误 |

注意：

- `dueAtIso` 使用 UTC ISO，页面展示时再转成本地时区。
- key 里包含 ISO 时间，ISO 时间本身包含 `:`，不要用简单 `key.split(":")` 解析 key。
- Bark 实际请求由 Worker 拼接为 `{barkUrl}/{encodedTitle}/{encodedMessage}?group=雷霆战机助手`。
- Web Push 实际请求由 Cron Worker 使用 VAPID 签名后发送到 subscription endpoint。

## `user:{userId}:webpush`

用户 Web Push subscription id 索引。创建 Web Push 提醒时，如果请求没有指定 `webPushSubscriptionIds`，Pages API 会使用该索引里的全部可用订阅。

```txt
key: user:0ed74018-6565-4aa8-8b16-f26e1c06868d:webpush
```

```json
{
  "userId": "0ed74018-6565-4aa8-8b16-f26e1c06868d",
  "subscriptionIds": ["sha256_endpoint_prefix"],
  "updatedAtIso": "2026-06-29T15:10:57.230Z"
}
```

## `webpush:{userId}:{subscriptionId}`

单个浏览器/设备的 Web Push subscription。`subscriptionId` 是 subscription endpoint 的 SHA-256 hex 前 32 位，用于避免把 endpoint 放进 key。

```txt
key: webpush:0ed74018-6565-4aa8-8b16-f26e1c06868d:sha256_endpoint_prefix
```

```json
{
  "subscriptionId": "sha256_endpoint_prefix",
  "userId": "0ed74018-6565-4aa8-8b16-f26e1c06868d",
  "username": "ginwu_pc_chrome",
  "endpointHash": "sha256_endpoint_prefix",
  "subscription": {
    "endpoint": "https://push.example/subscription-id",
    "expirationTime": null,
    "keys": {
      "p256dh": "base64url_public_key",
      "auth": "base64url_auth_secret"
    }
  },
  "userAgent": "Mozilla/5.0 ...",
  "createdAtIso": "2026-06-29T15:10:57.230Z",
  "updatedAtIso": "2026-06-29T15:10:57.230Z"
}
```

注意：

- `subscription.endpoint` 是发送 Web Push 必需数据，不放入 key，但会保存在 value 中。
- Web Push 返回 `404` 或 `410` 时，Cron Worker 会删除对应 `webpush:*` key，并更新 `user:{userId}:webpush` 索引。

## `failed:{dueAtIso}:{userId}:{uuid}`

失败提醒归档。Cron Worker 对到期 reminder 调用 Bark 失败时会增加 `retryCount`；当 `retryCount >= 3`，删除原 `reminder:` key，并写入对应 `failed:` key。

```txt
key: failed:2026-06-29T15:11:57.014Z:0ed74018-6565-4aa8-8b16-f26e1c06868d:49b49a98-f134-4c9d-a56a-e11d4186c14f
```

```json
{
  "id": "49b49a98-f134-4c9d-a56a-e11d4186c14f",
  "userId": "0ed74018-6565-4aa8-8b16-f26e1c06868d",
  "username": "ginwu_pc_chrome",
  "barkUrl": "https://api.day.app/YOUR_KEY/",
  "title": "雷霆战机提醒",
  "message": "体力快满了",
  "dueAtIso": "2026-06-29T15:11:57.014Z",
  "retryCount": 3,
  "createdAtIso": "2026-06-29T15:10:57.230Z",
  "lastError": "Bark 500"
}
```

## `scheduler:nextDueAt`

调度游标，用于把 Cron Worker 从“每次扫描 `reminder:` 前缀”改成“每次只读取下一批到期时间”。

```txt
key: scheduler:nextDueAt
```

```json
{
  "minuteIso": "2026-06-30T15:12:00.000Z",
  "bucketKey": "scheduler:due:2026-06-30T15:12:00.000Z",
  "minuteIsos": [
    "2026-06-30T15:12:00.000Z",
    "2026-06-30T15:25:00.000Z"
  ],
  "updatedAtIso": "2026-06-30T15:08:31.120Z"
}
```

字段说明：

| 字段 | 类型 | 中文说明 |
|---|---|---|
| `minuteIso` | string | 下一批到期提醒所在分钟，UTC ISO，秒和毫秒固定为 `00.000` |
| `bucketKey` | string | 对应的 `scheduler:due:{minuteIso}` key |
| `minuteIsos` | string[] | 所有待处理分钟 bucket 的排序队列，第一项必须等于 `minuteIso` |
| `updatedAtIso` | string | 该调度游标最后更新时间，UTC ISO 字符串 |

运行规则：

1. Cron Worker 每次触发时先 `get scheduler:nextDueAt`。
2. 如果 `minuteIsos[0] > now`，直接返回，不再 `list reminder:`。
3. 如果 `minuteIsos[0] <= now`，读取对应 `scheduler:due:{minuteIso}` bucket。
4. 处理 bucket 内的 reminder key。
5. 处理完成后删除空 bucket；如果仍有未到秒数的 reminder 或待重试 reminder，则写回 bucket。
6. 更新 `scheduler:nextDueAt.minuteIsos`，让第一项继续指向下一批需要处理的分钟。

## `scheduler:due:{minuteIso}`

分钟 bucket。它把同一分钟内需要处理的 reminder key 聚到一个 JSON value 里，避免 Cron Worker 每分钟扫描所有 `reminder:` key。

```txt
key: scheduler:due:2026-06-30T15:12:00.000Z
```

```json
{
  "minuteIso": "2026-06-30T15:12:00.000Z",
  "reminderKeys": [
    "reminder:2026-06-30T15:12:20.000Z:0ed74018-6565-4aa8-8b16-f26e1c06868d:49b49a98-f134-4c9d-a56a-e11d4186c14f",
    "reminder:2026-06-30T15:12:45.000Z:0ed74018-6565-4aa8-8b16-f26e1c06868d:fad6770d-e400-4cb7-92aa-ff39c51063b5"
  ],
  "updatedAtIso": "2026-06-30T15:08:31.120Z"
}
```

字段说明：

| 字段 | 类型 | 中文说明 |
|---|---|---|
| `minuteIso` | string | bucket 对应的分钟，UTC ISO，秒和毫秒固定为 `00.000` |
| `reminderKeys` | string[] | 该分钟内需要处理的 `reminder:` key 列表 |
| `updatedAtIso` | string | bucket 最后更新时间，UTC ISO 字符串 |

写入和更新规则：

- 创建提醒时，Pages API 仍写入原始 `reminder:{dueAtIso}:{userId}:{uuid}`。
- 同时把该 reminder key 加入对应的 `scheduler:due:{minuteIso}` bucket。
- 同时把该 `minuteIso` 加入 `scheduler:nextDueAt.minuteIsos`，并按时间排序。
- 取消提醒时，Pages API 仍删除原始 `reminder:` key；bucket 内可以延迟清理，Cron Worker 到点后发现 reminder key 不存在则跳过。
- Cron Worker 处理完 bucket 后，如果没有剩余 reminder key，则删除 `scheduler:due:{minuteIso}`；如果还有待重试或同一分钟内尚未到秒数的 reminder key，则写回 bucket。

注意：

- `scheduler:nextDueAt` 和 `scheduler:due:{minuteIso}` 是减少 KV `list` 用量的索引，不替代 `reminder:` 作为提醒数据源。
- Bark 发送前仍必须 `get reminder:{dueAtIso}:{userId}:{uuid}`，以 KV 中真实 reminder 是否存在为准。
- 如果索引和 `reminder:` 数据不一致，以 `reminder:` 是否存在为最终判断。

## Reminder 字段要求

Cron Worker 发送提醒时会读取 `channels`、`barkUrl`、`webPushSubscriptionIds`、`title`、`message`、`dueAtIso`、`retryCount`、`delivery`、`lastError`。

- 旧 reminder 缺少 `channels` 时，按 `["bark"]` 处理。
- Bark 通道需要 `barkUrl`。
- Web Push 通道需要 `userId`，并需要 `webPushSubscriptionIds` 或 `user:{userId}:webpush` 索引中存在可用订阅。
- `delivery` 中已成功的通道不会在重试时重复发送。
