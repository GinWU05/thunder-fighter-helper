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

### 日常完整开发：前端热更新 + Pages Functions + Cron Worker

一条命令同时启动 Next.js、Pages Functions 和 Cron Worker：

```bash
pnpm dev:all
```

打开 [http://localhost:8788](http://localhost:8788)。这个地址由 Wrangler Pages dev 提供 `/functions`，并把前端请求代理到 Next dev，所以前端代码更新后不需要重新 `pnpm build`。

手动触发 scheduled handler：

```bash
curl "http://localhost:8787/__scheduled"
```

### 单独运行 Pages Functions 代理

如果已经另开终端跑了 `pnpm dev`，可以单独启动 Pages Functions 代理，不启动 Cron Worker：

```bash
pnpm dev:pages
```

### 静态预览模式

如果想模拟 Cloudflare Pages 生产部署的静态 `out/` 目录，先构建：

```bash
pnpm build
```

再跑静态 Pages dev：

```bash
pnpm dev:pages:static
```

注意：

- 本地 Cron 不会自动每分钟触发；需要用上面的 `curl` 手动触发。
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
  - 每分钟读取调度游标并处理到期 reminder
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
