Tjhis is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

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

## 2. Pages Functions：/functions

- 类型：Cloudflare Pages Functions
- 所属组件：Pages `thunder-fighter-helper`
- 仓库路径：`/functions`
- 运行时：Cloudflare Workers runtime
- 职责：
  - 注册 username
  - 绑定/解绑用户
  - 创建/查看/取消 reminder
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
  - 每分钟扫描到期 reminder
  - 调用 Bark URL
  - 成功后删除 reminder
  - 失败后增加 retryCount

### 资源绑定

| 类型 | Binding | 指向 |
|---|---|---|
| KV | `REMINDERS_KV` | `thunder-fighter-helper` |

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
| `reminder:{dueAtIso}:{userId}:{uuid}` | 待触发提醒；value 内包含 barkUrl、title、message、retryCount |
| `failed:{dueAtIso}:{userId}:{uuid}` | 失败提醒；由 Cron Worker 在 retryCount >= 3 后从 reminder key 移入 |

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
