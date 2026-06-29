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
| `reminder:{dueAtIso}:{userId}:{uuid}` | JSON | 待触发提醒 | Pages API 创建提醒 | Pages API 列表/取消、Cron Worker 扫描 | Pages API 取消、Cron Worker 成功发送 |
| `failed:{dueAtIso}:{userId}:{uuid}` | JSON | 失败 3 次后的提醒归档 | Cron Worker | 人工排查 | 人工清理 |

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

待触发提醒。Pages API 创建，Cron Worker 每分钟扫描 `reminder:` 前缀。

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
  "createdAtIso": "2026-06-29T15:10:57.230Z"
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
| `lastError` | string | 可选，失败后记录最后一次错误 |

注意：

- `dueAtIso` 使用 UTC ISO，页面展示时再转成本地时区。
- key 里包含 ISO 时间，ISO 时间本身包含 `:`，不要用简单 `key.split(":")` 解析 key。
- Bark 实际请求由 Worker 拼接为 `{barkUrl}/{encodedTitle}/{encodedMessage}?group=雷霆战机助手`。

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

## 旧数据兼容

Cron Worker 兼容读取旧字段：

| 旧字段 | 当前字段 | 说明 |
|---|---|---|
| `body` | `message` | Worker 发送 Bark 时会 fallback 到 `body` |
| `dueAt` | `dueAtIso` | Worker 判断到期时间时会 fallback 到 `dueAt` |
| `status` | 无 | 如果存在且不是 `pending`，Worker 会跳过 |

Pages API 当前不会写这些旧字段。

## 当前没有使用的 key

```txt
user:{userId}:settings
```

当前代码没有写入用户级 settings。Bark URL、提醒标题和提醒内容都保存在每条 `reminder:` value 内。
