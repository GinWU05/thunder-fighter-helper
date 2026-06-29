# Cloudflare KV 过滤删除操作 Prompt

你是本仓库的维护 agent。目标是在开发/排查阶段，按 key 或 value 条件过滤 Cloudflare KV `REMINDERS_KV` 中的多条数据，并在明确确认后批量删除。

## 背景

Cloudflare 控制台 Web UI 不方便全量/批量删除 KV item。当前项目的 KV schema 见：

- `docs/cloudflare-kv-schema.md`

KV namespace：

- Binding：`REMINDERS_KV`
- 用途：服务端提醒系统

## 重要约束

1. 默认只做 dry-run，不直接删除。
2. 删除前必须列出将删除的 key 总数和 key 列表。
3. 删除前必须让用户明确确认。
4. 不要删除不匹配过滤条件的 key。
5. 不要把 Bark URL、ownerTokenHash 等敏感 value 原样输出到最终回复；需要展示时要打码。
6. 如果 Cloudflare API token / wrangler 登录不可用，停止并告诉用户需要提供什么，不要猜。
7. 生产 KV 删除不可逆；如果条件过宽，必须提醒用户缩小条件。

## 推荐执行方式

优先使用 Wrangler CLI，而不是 Cloudflare Web UI。

如果本机已登录 Wrangler：

```bash
workers/reminder-cron/node_modules/.bin/wrangler kv key list \
  --remote \
  --namespace-id <KV_NAMESPACE_ID> \
  --prefix '<KEY_PREFIX>'
```

必须显式加 `--remote`。不加时 Wrangler 可能读取本地 `.wrangler/state`，dry-run 结果不能代表 Cloudflare 远端 KV。

如果未登录，需要用户提供以下任一方式：

```bash
export CLOUDFLARE_API_TOKEN=...
```

或让用户自己在交互终端执行：

```bash
wrangler login
```

## 输入参数

执行前向用户确认这些参数：

| 参数 | 必填 | 示例 | 说明 |
|---|---|---|---|
| `namespaceId` | 是 | `cdbd755b3b2043f6b559ec805303a3f5` | KV namespace id |
| `keyPrefix` | 是 | `reminder:` | key 前缀，必须尽量具体 |
| `keyIncludes` | 否 | `0ed74018-...` | key 中必须包含的字符串 |
| `valueIncludes` | 否 | `"username":"ginwu_pc_chrome"` | value 中必须包含的字符串 |
| `delete` | 否 | `false` | 默认 false，只 dry-run |

## 过滤规则

候选 key 先按 `keyPrefix` 列出，再依次应用：

1. 如果提供 `keyIncludes`，只保留 key 中包含该字符串的 item。
2. 如果提供 `valueIncludes`，读取每个候选 key 的 value，只保留 value 中包含该字符串的 item。
3. 输出 dry-run 结果。
4. 只有用户明确说“确认删除这些 key”后，才执行删除。

## Dry-run 输出格式

```txt
Dry-run only. No KV item was deleted.

Namespace: <namespaceId>
Prefix: <keyPrefix>
Filters:
- keyIncludes: <keyIncludes or none>
- valueIncludes: <valueIncludes or none>

Matched: <n>
Keys:
1. <key>
2. <key>
```

如果匹配数量很大，只展示前 50 条，并提示用户缩小过滤条件。

## 删除命令

逐条删除，避免误删时难以追踪：

```bash
workers/reminder-cron/node_modules/.bin/wrangler kv key delete \
  --remote \
  --namespace-id <KV_NAMESPACE_ID> \
  '<KEY>'
```

删除后再次 list 同样条件，确认匹配数量为 0 或符合预期。

## 推荐过滤示例

删除某用户的旧 pending reminder：

```txt
keyPrefix = reminder:
keyIncludes = :<userId>:
valueIncludes = "username":"<username>"
delete = false
```

删除某用户的 failed reminder：

```txt
keyPrefix = failed:
keyIncludes = :<userId>:
valueIncludes = "username":"<username>"
delete = false
```

查找缺少 Bark URL 的旧 reminder：

```txt
keyPrefix = reminder:
valueIncludes 不适合表达“缺少字段”
```

这种场景需要读取 JSON 后用脚本判断 `!value.barkUrl`，不要用简单字符串过滤。

## 方案评估

这个方案适合开发阶段和少量生产数据清理：

- 优点：不需要额外后台管理页面，不引入新服务，直接操作真实 KV。
- 优点：dry-run + 明确确认可以降低误删风险。
- 缺点：Wrangler/API token 权限较高，必须谨慎保管。
- 缺点：大量 key 扫描会慢，Cloudflare KV list 也不是强一致。
- 缺点：value 条件过滤需要逐条 get，不适合非常大的 namespace。

## 其他方案

### 方案 A：一次性本地脚本

在 `scripts/` 下写一个只读 dry-run 默认的 Node 脚本，通过 Cloudflare REST API 执行 list/get/delete。

适合：

- 经常需要做同类清理。
- 希望过滤 JSON 字段，例如 `retryCount >= 3`、缺少 `barkUrl`、`dueAtIso < now`。

缺点：

- 要维护脚本和 API token 权限。
- 容易从“临时工具”长成半个管理后台。

### 方案 B：临时 Admin Pages Function

加一个受 `REMINDER_SECRET` 或独立 admin secret 保护的临时 API，用于列出/删除 KV。

适合：

- 不想在本机配置 Wrangler。
- 希望通过浏览器操作。

缺点：

- 风险更高，线上暴露删除能力。
- 必须做强鉴权和部署后及时移除。

### 方案 C：Cloudflare Dashboard 手工删除

适合：

- 只删 1-3 条明确 key。

缺点：

- 不适合批量。
- 容易漏删。

## 默认建议

优先用 Wrangler + dry-run prompt 流程。只有当清理规则变复杂，才考虑写一次性脚本；不要为了开发期清理 KV 引入长期后台管理功能。
