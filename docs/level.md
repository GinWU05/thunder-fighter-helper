# 收集关卡信息

本文档描述如何为游戏助手构建并持续维护关卡数据（普通/英雄难度），包括：关卡元数据的范围定义、JSON 数据格式、截图采集规范、AI 半自动解析流程与人工校验方法。目标是以最小的人力成本获得可用且可迭代的数据资产。

---

## 背景与目标

### 背景

* 游戏关卡数据存在于客户端资源中，直接解包/解析遇到二进制格式与性能问题，自动化成本高且迭代慢。
* 现阶段需要“人力干预 + 可规模化流程”，先让助手具备可用的关卡导航/推荐能力，再逐步完善字段与自动化程度。

### 目标

* 形成一套**稳定的关卡数据源**：普通难度、英雄难度两套 JSON。
* 支持**增量更新**：新增关卡或字段时，能低成本补齐。
* 支持**可审计**：每条数据可追溯到截图证据或人工录入来源。

### 非目标

* 不在本文档中定义关卡数值平衡策略或玩法攻略逻辑（仅定义数据采集与结构）。
* 不承诺通过解包彻底还原所有后端规则（掉落概率等若不可见则不强求）。

---

## 关卡介绍与数据范围

### 难度分类与关卡规模

* 普通难度：已实装关卡数 ≥112，规划上限 144（高关卡偏长期养成/重氪）。
* 英雄难度：已实装 24，规划上限 36（部分关卡仍在开发中）。

> 注：数据层面需区分 `implemented` 与 `planned/unknown`，避免“关卡不存在但被误认为缺失”。

### 关卡层级结构

* `mode`：normal / hero
* `chapter`（如有章节/地图页）：用于分组展示与跳转
* `stageId`：关卡编号（全局唯一，整型）
* `stageName`：关卡名称（如 UI 中有）
* `unlock`：解锁条件（前置关卡/等级/主线进度等）

### 材料与掉落基础字典

* 进阶材料（3★/4★/5★/战神）
* 消耗品（经验材料）：BOSS/大敌机/小敌机残骸 `lvX`（可变参数）

该字典作为全局静态资源：关卡掉落字段应引用 `itemId` 或 `templateId`，避免写死中文名导致后续维护困难。

---

## 定义关卡信息格式

关卡掉落只引用字典 id，不直接写材料中文名

### 文件与目录约定

* `data/levels/normal-level.json`
* `data/levels/hero-level.json`
* `data/items/item-dictionary.json`（材料/掉落字典，包含模板项）




### 关卡 JSON Schema（建议）

每条关卡至少包含以下字段（MVP 可先做必填，扩展字段可置空）：

* `id`：int，关卡编号
* `mode`：`normal` | `hero`
* `chapter`：int|null
* `nameZh`：string|null
* `status`：`implemented` | `planned` | `unknown`
* `unlock`：object|null（例如 `{ "type": "prev_clear", "value": 12 }`）
* `recommendedPower`：int|null
* `drops`：array（元素为 `{ "itemId": "...", "qty": number|null }` 或模板参数）
* `notes`：string|null
* `sources`：array（截图证据引用，如文件名列表）

### normal-level.json 示例

（写一个 1–2 条示例即可，强调字段含义与可为空策略）

### hero-level.json 示例

同上，说明英雄难度是否沿用同结构；如字段不同（例如敌人强化），在 schema 中以 `heroModifiers` 扩展。

### item-dictionary.json Schema（核心要点）

* 固定物品：`itemId + nameZh + tier + category + aliases`
* 模板物品（lvX）：`templateId + namePatternZh + regex + params`

---

## 技术方案

### 方案概览

* **方案 A：纯手动录入（MVP）**
  适用于字段少、需要快速可用；风险在于后续扩展成本高。
* **方案 B：截图采集 + AI 解析（增量维护）**
  适用于字段多、长期维护；需要严格的截图规范与抽查机制。
* **推荐：A 打底 + B 增量**
  先手工搭骨架保证可用，再通过截图与 AI 逐步填充字段与新增关卡。

### 数据流水线（推荐）

1. 采集素材（关卡列表页/关卡详情页/材料字典页）
2. AI 解析生成草稿 JSON（或增量 patch）
3. 人工校验（抽查 + 关键字段强校验）
4. 合入主数据（版本号更新 + changelog）
5. 回归检查（助手消费端验证无 schema break）

### 关键风险与控制点

* 关卡编号错位：通过“文件名含关卡号”规避
* UI 动效/特效导致误读：通过截图规范（固定缩放/关闭特效）与抽查控制
* 名称不一致：通过 `item-dictionary` 的 `aliases` 与模板 regex 统一口径

---

## 数据素材

### 截图类型

* 关卡列表（用于：关卡顺序、章节边界、解锁提示）
* 关卡详情（用于：推荐战力、掉落、首通奖励、敌人特性等）
* 材料字典/掉落说明（用于：icon → itemId 映射与别名纠错）

### 命名规范

* 关卡截图：`{difficulty}_{stageId}_{infoType}.png`
* 字典截图：`dict_{category}_{subtype}_{index}.png`（示例在此列出）

#### 关卡截图

* `{difficulty}_{stageId}_{infoType}.png`

  * difficulty：`normal` / `hero`
  * infoType：`list` / `detail` / `drops` / `rewards` / `enemy` 等（根据实际 UI）

示例：

* `normal_012_list.png`
* `normal_012_detail.png`
* `hero_003_drops.png`

#### 全局字典截图

* `dict_materials_advanced_3star.png`
* `dict_materials_advanced_4star.png`
* `dict_materials_advanced_5star.png`
* `dict_materials_advanced_war_god.png`
* `dict_consumables_exp_1.png`

### 截图规范（质量要求）

* 同屏包含“图标 + 名称 + 星级/品质标识”（用于纠错与训练别名）
* 不裁切关键信息（关卡号/难度标签必须可见）
* 固定分辨率与缩放（建议统一设备与分辨率）
* 若 UI 可滚动：每张截图至少有 20–30% 重叠，方便校验漏项

### 数据校验规则

* 连续性：normal 关卡 id 不跳号（若跳号必须在 notes 解释）
* 唯一性：同 mode 下 `id` 唯一
* 掉落引用：`drops[].itemId/templateId` 必须存在于 `item-dictionary`
* 模板参数：lvX 必须可被 regex 解析，且 level 为正整数

---

## 版本管理与变更记录

### 数据版本号

* 顶层字段 `version` 使用日期或语义化版本（如 `2026-01-03`）
* 每次更新记录：

  * 新增关卡范围（例如 normal 113–116）
  * 修改字段（例如修正某关掉落）
  * 新增物品字典项/别名

### Changelog（建议）

* `data/CHANGELOG.md` 或在 JSON 内附 `changelog` 数组（简短即可）

---

## 附录

### 术语表

* implemented / planned / unknown
* itemId / templateId
* sources（证据截图）

### 示例：经验材料模板解析

展示 `BOSS的残骸lv12` 如何匹配模板并提取 `level=12`。

---

如果你希望我进一步把这篇文档变成“可直接提交”的版本，我可以按你们常用的格式补上：

* 完整的 JSON Schema（含字段类型、必填/可空）
* 一份最小可用的 `item-dictionary.json`（把你已列出的材料全部写进去，含 lvX 模板）
* 以及一个“截图清单 checklist”（按普通/英雄各需要截哪些页）。
