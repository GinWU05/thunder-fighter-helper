# Thunder Fighter Helper

## 本地运行

本项目是静态导出的 Next.js 前端 + Cloudflare Pages Functions + 独立 Cron Worker。只跑 `pnpm dev` 时不会运行 `/functions`，所以“设置提醒”的 API 需要用 Cloudflare Pages 本地模式。

### 安装依赖

```bash
pnpm install
```

### 只看前端

```bash
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。这个模式适合调 UI，但不会运行 `/functions/api/reminders/*`。

### 环境变量

不要提交真实 `.env`。需要区分环境时，使用 Next.js 兼容的 env 文件名：

| 文件 | 用途 |
|---|---|
| `.env.development` | 本地开发默认值 |
| `.env.development.local` | 本地开发私有值，不提交 |
| `.env.production` | 生产构建默认值 |
| `.env.production.local` | 生产构建私有值，不提交 |

### 日常完整开发：前端热更新 + Pages Functions + Cron Worker

一条命令同时启动 Next.js、Pages Functions、本地 KV 和 Cron Worker：

```bash
pnpm dev:all
```

打开 [http://localhost:8788](http://localhost:8788)。这个地址由 Wrangler Pages dev 提供 `/functions`，并启动 Next dev 作为前端代理，所以前端代码更新后不需要重新 `pnpm build`。

Cron Worker 会监听 [http://localhost:8787](http://localhost:8787)。本地 Wrangler 不会自动按 `* * * * *` 触发 scheduled handler；需要手动访问：

```bash
curl "http://localhost:8787/__scheduled"
```

真正“到点自动发送 Bark”发生在 Cloudflare 上部署后的 Cron Trigger。

注意：

- Pages dev 和 Worker dev 都使用 `--persist-to=.wrangler/state`，目的是共用本地 KV 状态。
- Bark URL 在页面里填写；测试 Bark 或到期 Cron 会真实请求该 Bark URL。

# Cloudflare 部署结构

## 1. Pages：thunder-fighter-helper

- 类型：Cloudflare Pages
- 仓库：GinWU05/thunder-fighter-helper
- 部署路径：repo root
- 生产域名：https://fly.screw-hand.com
- 职责：
  - 部署 Next.js / PWA 前端
  - 运行 `/functions` 下的 Pages Functions
  - 提供 `/api/reminders/*`

### 资源绑定

| 类型 | Binding | 指向 |
|---|---|---|
| KV | `REMINDERS_KV` | `thunder-fighter-helper` |

### 环境变量

| 名称 | 说明 |
|---|---|
| `REMINDER_SECRET` | Pages API 鉴权 |
| `WEB_PUSH_VAPID_PUBLIC_KEY` | Web Push VAPID 公钥，Pages Functions 测试通知使用 |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | Web Push VAPID 私钥，使用 Cloudflare Secret 保存 |
| `WEB_PUSH_VAPID_SUBJECT` | Web Push VAPID subject，例如 `mailto:you@example.com` |

## 2. Pages Functions：/functions

- 类型：Cloudflare Pages Functions
- 所属组件：Pages `thunder-fighter-helper`
- 仓库路径：`/functions`
- 运行时：Cloudflare Workers runtime
- 职责：
  - 注册 username
  - 绑定/解绑用户
  - 创建/查看/取消 reminder
  - 保存/删除 Web Push subscription
  - 发送 Web Push 测试通知
  - 写入 `REMINDERS_KV`

注意：
`/functions` 不是 Next.js API Route。
它不经过 Next.js 后端。

## 3. Worker：thunder-fighter-helper-cron

- 类型：Cloudflare Worker
- 仓库：GinWU05/thunder-fighter-helper
- 部署路径：`/workers/reminder-cron`
- 职责：
  - 运行 Cron Trigger
  - 每分钟读取调度游标并处理到期 reminder
  - 调用 Bark URL
  - 发送 Web Push
  - 成功后删除 reminder
  - 失败后增加 retryCount

### 资源绑定

| 类型 | Binding | 指向 |
|---|---|---|
| KV | `REMINDERS_KV` | `thunder-fighter-helper` |

### Secrets

| 名称 | 说明 |
|---|---|
| `WEB_PUSH_VAPID_PUBLIC_KEY` | Web Push VAPID 公钥 |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | Web Push VAPID 私钥 |
| `WEB_PUSH_VAPID_SUBJECT` | Web Push VAPID subject，例如 `mailto:you@example.com` |

### Cron

在 Worker `thunder-fighter-helper-cron` 的 Cloudflare 后台添加 Cron Trigger：

| 字段 | 值 | 说明 |
|---|---|---|
| Cron 表达式 | `* * * * *` | 每分钟触发一次 |

## 4. KV：thunder-fighter-helper

- 类型：Cloudflare KV Namespace
- Binding 名称：`REMINDERS_KV`
- 被以下组件使用：
  - Pages `thunder-fighter-helper`
  - Worker `thunder-fighter-helper-cron`
- Key/value schema：见 [`docs/cloudflare-kv-schema.md`](docs/cloudflare-kv-schema.md)

### 主要 key

| Key 前缀 | 用途 |
|---|---|
| `username:{username}` | username 占用关系 |
| `user:{userId}:profile` | 用户资料，包含 username、ownerTokenHash、createdAtIso |
| `user:{userId}:webpush` | 用户 Web Push subscription id 索引 |
| `webpush:{userId}:{subscriptionId}` | 单个浏览器/设备的 Web Push subscription |
| `reminder:{dueAtIso}:{userId}:{uuid}` | 待触发提醒；value 内包含 barkUrl、title、message、retryCount |
| `failed:{dueAtIso}:{userId}:{uuid}` | 失败提醒；由 Cron Worker 在 retryCount >= 3 后从 reminder key 移入 |
| `scheduler:nextDueAt` | 调度游标；记录下一批到期分钟和待处理分钟队列 |
| `scheduler:due:{minuteIso}` | 分钟 bucket；记录该分钟需要处理的 reminder key 列表 |

核心层级：

```txt
Cloudflare 组件
├─ Pages
│  ├─ repo root
│  └─ /functions
├─ Worker
│  └─ /workers/reminder-cron
└─ KV
   └─ 被 Pages 和 Worker 共同绑定
```

## Web Push 手动验证

本项目不提交真实 VAPID key。部署前需要在 Cloudflare Pages 和 Cron Worker 中配置：

- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_VAPID_SUBJECT`

其中 VAPID 公钥使用 65 字节 raw public key 的 base64url 字符串，私钥使用 32 字节 raw private key 的 base64url 字符串。

前端构建还需要公开变量：

- `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`

验证步骤：

1. 运行 `pnpm dev:all`，打开 [http://localhost:8788](http://localhost:8788)。
2. 注册提醒用户后点击“开启 Web”，允许浏览器通知权限。
3. 点击“测试 Web”，确认当前浏览器收到通知。
4. 创建一个 1-2 分钟后的提醒，并勾选 `Web 通知`。
5. 手动触发 Cron：`curl "http://localhost:8787/__scheduled"`。
6. 到生产环境后，用 iPhone 分别验证普通 Safari 页面提示添加到主屏幕、从主屏幕图标打开后可开启通知。
