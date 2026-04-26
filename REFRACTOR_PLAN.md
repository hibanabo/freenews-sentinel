# Sentinel 逻辑重构计划

> **核心定位调整**：Sentinel 从"本地 LLM 打分器"改造为 **双 Tier 产品**——
> - **基础模式（Tier 1）**：只需 FreeNews API Key，后端指标直接驱动告警。**零额外成本、开箱即用、面向引流**。
> - **高级模式（Tier 2）**：用户接入自己的 LLM + 角色 preset，LLM 基于后端已给的结构化信号做**角色化重打分**。
>
> Settings 页面现成的 `basic` / `advanced` 两个 tab 正好匹配这个分层。

---

## 一、为什么重构

### 1.1 后端已经做了通用 NLU

`GET /api/v1/search` 返回的 `aiAnalysis` 字段里已经有：

| 字段 | 含义 |
|------|------|
| `titleZh` / `titleEn` / `summaryZh` / `summaryEn` | 中英双语标题摘要 |
| `keywordsZh` / `keywordsEn` | 中英文关键词 |
| `entities` | 人/公司/地点/事件 实体列表 |
| `categories` | 新闻分类 |
| `sentimentScore` | 0~1，越低越负面 |
| `sentimentLabel` | positive / neutral / negative / mixed |
| **`importanceScore`** | **1~10 整数，通用重要性**（本次重构的核心信号） |
| `readingTime` | 预计阅读时间 |

这意味着"这条新闻是什么、有多重要、什么情绪"**后端已经给了权威答案**。

### 1.2 Sentinel 当前的错位

当前 `monitor.ts` + `ai-evaluate.ts` 的流程：

```
拉新闻 → 按 sentimentScore 预筛 → 本地 LLM 再算一遍 sentiment/impact/urgency/relevance → 基于 LLM 结果告警
```

问题：

1. **LLM 在重算后端已给的指标**（sentiment / 通用影响面）→ 浪费 token
2. **完全不用 `importanceScore` 和 `entities`** → 放着最有用的信号不用
3. **引流用户必须先配一个 LLM 才能用** → 引流漏斗在这里卡死一大批
4. **角色化判断被混在通用打分里** → 其实"对 OSINT 来说这新闻重不重要"才是后端永远做不了、必须本地 LLM 做的事

### 1.3 重构后的职责划分

| 层 | 做什么 | 在哪里 |
|----|--------|--------|
| 后端 FreeNews | "这条新闻是什么、通用重要性、情感" | `GET /api/v1/search` |
| **Tier 1 Sentinel** | 关键词命中 + importance/sentiment 阈值 = 告警 | 本地纯规则 |
| **Tier 2 Sentinel** | 在 Tier 1 通过的基础上，让用户 LLM 从"角色"视角重打一次相关性分 | 本地 LLM（用户自配） |

---

## 二、Tier 1 · 基础模式

### 2.1 用户画像

- 只想"监控几个关键词，出大新闻提醒我"的普通用户
- 不想配第二个 LLM API Key
- README 第一屏看完就能开箱即用
- **这是引流到 freenews.site 的主力**

### 2.2 告警决策（纯本地规则，零 LLM 调用）

对每条新文章：

```
告警条件 = 关键词命中 && (
  importanceScore >= importanceThreshold  OR
  sentimentScore  <= negativeSentimentThreshold
)
```

- 关键词命中其实在调后端 search 时就已经完成（`buildQueryFromKeywords` 拼查询）
- `importanceThreshold` 默认 **7**
- `negativeSentimentThreshold` 默认 **0.25**

### 2.3 severity 本地合成

```ts
function computeSeverity(importance: number | null, sentiment: number | null): 'high' | 'medium' | 'low' {
  const imp = importance ?? 0
  const sent = sentiment ?? 0.5
  if (imp >= 9 || (imp >= 7 && sent <= 0.2)) return 'high'
  if (imp >= 7 || sent <= 0.25) return 'medium'
  return 'low'
}
```

### 2.4 Tier 1 **不做**的事

- 不做本地 LLM 调用
- 不跟踪 entities（维持最简）
- 不做角色区分（所有用户共享同一个规则）
- `aiEnabled=false` 时完全跳过 `ai-evaluate.ts`

---

## 三、Tier 2 · 高级模式

### 3.1 用户画像

- 有明确身份（OSINT 分析师 / 投资者 / 合规官 / 公关 / 通用分析师）
- 愿意投入配置自己的 LLM 的用户
- 希望 Sentinel 理解"对我这个角色来说，这条新闻意味着什么"

### 3.2 决策流水线：**硬筛 + LLM 角色重打分**

```
新文章
  ↓
Stage A · 硬筛（复用 Tier 1 的规则，省 token）
  · importanceScore ≥ importanceThreshold  OR
  · sentimentScore  ≤ negativeSentimentThreshold
  ↓ 通过 → 进入 Stage B；不通过 → 丢弃
  ↓
Stage B · 角色 LLM 重打分
  输入：后端已给的所有结构化信号 + 角色 prompt
  输出：roleRelevance (0~1) + reasoning + triggerAlert
  ↓ roleRelevance ≥ relevanceAlertThreshold && triggerAlert → 告警
  ↓
Stage C · severity 合成（用 Tier 1 规则 + roleRelevance 加权）
```

### 3.3 LLM 职责收窄

**`ai-evaluate.ts` → 新的 `LLMResult`**：

```ts
export interface LLMResult {
  articleId?: number
  index: number
  roleRelevance: number    // 0~1，从角色视角的相关度
  triggerAlert: boolean    // 即使相关度高，角色也可以说"不值得打扰我"
  reasoning: string        // 一句中文，说明为何相关/为何忽略
}
```

**删除**：`sentimentScore`, `impactScore`, `impactDirection`, `urgency` —— 这些都从后端 `aiAnalysis` 来。

**新的 prompt**（短且精）：

```
你是 {{角色}}。下面每条新闻的通用重要性 (importance, 1-10) 和情感 (sentiment, 0-1) 已由上游给出。
请只回答：作为该角色，这条新闻对你的相关度 (0~1)，以及是否应该立刻提醒你。

返回 JSON 数组，字段 camelCase：
[
  { "index": 1, "articleId": 123, "roleRelevance": 0.85, "triggerAlert": true, "reasoning": "一句中文" }
]
只输出 JSON，不要额外文字。

新闻列表（含 importance / sentiment / 实体 / 分类）：
{{articles_json}}
```

相比现在的 prompt，输入内容不变（甚至更精简），但**不再让 LLM 自己去感知情感和重要性**——只做角色相关性判断。

### 3.4 角色 Preset 精简

当前 9 个 preset 压缩到 **5 个核心角色**：

| 保留 | 合并 | 移除 |
|------|------|------|
| 🛰 OSINT · 地缘政治情报 | 📈 金融投资者（股票 + 加密合并） | 🔬 科技从业者 |
| ⚖️ 合规法务 | | 🌏 供应链 |
| 🏢 企业公关 | | 📰 媒体人 |
| 🔍 通用舆情分析（兜底） | | |

每个 preset 的 prompt 统一精简到 **15~20 行**，内容围绕「这个角色关心什么样的变化」，删除情感/重要性的打分规则（因为不再让 LLM 做这件事）。

用户仍可在"高级设置"里添加自定义角色 preset（现有 `customPresets` 机制保持）。

---

## 四、数据模型改动

### 4.1 `SearchArticle` / `TopicRunArticle`（`monitor.ts` + `store.ts`）

新增字段：

```ts
importanceScore: number | null   // 1~10，来自后端 aiAnalysis.importanceScore
```

`entities` / `categories` 不在本重构引入给 Tier 1 使用，但类型里保留以备将来。

### 4.2 `Alert`（`store.ts`）

```ts
articleImportance: number | null   // UI 展示用
```

旧字段 `aiImpact`/`aiImpactDirection`/`aiUrgency`：保留，但 Tier 1 不再赋值；Tier 2 也不再产生（LLM 不再给）。迁移期可把它们标注为 deprecated，新告警一律 null，旧告警自然沉淀消失。

### 4.3 `Settings`（`store.ts`）

新增：

```ts
importanceThreshold: number         // 默认 7，Tier 1+2 都用
negativeSentimentThreshold: number  // 默认 0.25，Tier 1+2 都用
relevanceAlertThreshold: number     // 默认 0.6，仅 Tier 2 用
```

旧字段 `aiPrescreenEnabled` / `aiPrescreenThreshold`：Tier 2 下等价于硬筛开关 + sentiment 阈值，`migrateStore` v4 映射到新字段后删除。

`aiDecisionMode` 保留但简化：
- `threshold_only` → Tier 1（UI 上直接叫"基础模式"）
- `hybrid` → Tier 2（UI 上叫"角色化高级模式"）
- `llm_only` 移除，不再提供

### 4.4 storeVersion

v3 → **v4**，`migrateStore()` 负责老字段映射。

---

## 五、UI 改动

### 5.1 Settings 页面（`Settings.tsx`）

现有 `activeTab: 'basic' | 'advanced'` 保留，**内容重新分配**：

**Basic tab**（零门槛，引流）：
- FreeNews API Key + 连接测试
- 监控间隔、获取数量
- **新增**：重要性触发阈值 slider（1-10，默认 7）
- **新增**：负面情感阈值 slider（0-1，默认 0.25）
- 通知 / 声音 / 自启动开关
- ❌ **不显示任何 AI 相关配置**

**Advanced tab**（开角色化模式）：
- "启用角色化 AI 重打分" 总开关（= `aiEnabled`）
- LLM Provider / Base URL / API Key / Model
- 角色 preset 选择（5 个核心 + 自定义）
- 角色相关度告警阈值 slider（0-1，默认 0.6）
- AI 连接测试

### 5.2 其他页面

- **`Dashboard.tsx`**：Topic Run 的文章列表每行增加 importance 徽章（7 黄、8 橙、9-10 红）
- **`Alerts.tsx`**：Alert 详情卡片显示 `articleImportance`；Tier 2 告警额外显示 `aiReasoning`
- **`Keywords.tsx`**：不变
- **i18n**：`src/renderer/src/i18n.ts` 及 zh/en 文案增加上述 4 个新文案 key

---

## 六、文件清单

| 操作 | 路径 | 说明 |
|------|------|------|
| 修改 | `src/main/monitor.ts` | `SearchArticle` 加 `importanceScore`；`checkGroup` 重写为 Tier 1 / Tier 2 分流 |
| 修改 | `src/main/ai-evaluate.ts` | `LLMResult` 精简；prompt 重写 |
| 修改 | `src/main/store.ts` | `Settings` / `Alert` / `TopicRunArticle` 新字段；`migrateStore` v4 |
| 修改 | `src/renderer/src/presets.ts` | 9 → 5 核心角色，prompt 全部改写精简 |
| 修改 | `src/renderer/src/pages/Settings.tsx` | basic/advanced tab 内容重新分配 |
| 修改 | `src/renderer/src/pages/Dashboard.tsx` | importance 徽章 |
| 修改 | `src/renderer/src/pages/Alerts.tsx` | importance 显示、Tier 2 reasoning 展示 |
| 修改 | `src/renderer/src/i18n.ts` + `locales/*` | 新文案 |
| 更新 | `README.md` | "30 秒开箱即用"截图 + 高级模式入口说明 |
| 更新 | `AI_FEATURE_PLAN.md` | 标 legacy，指向本文档 |

估算：6-8 个核心文件，~600 行增减。

---

## 七、分阶段落地

| 阶段 | 目标 | 工作量 |
|------|------|--------|
| **P0** | 数据模型：`SearchArticle` / `Alert` / `TopicRunArticle` 加 `importanceScore`；Dashboard / Alerts UI 展示。**不改决策逻辑**。 | 0.5 天 |
| **P1** | Tier 1 落地：`checkGroup` 改写为"纯规则模式"（`aiEnabled=false` 时走这条）；新增 `importanceThreshold` / `negativeSentimentThreshold` 设置；Basic tab 重新布局。**此时 Tier 1 已经能引流**。 | 1 天 |
| **P2** | Tier 2 落地：`ai-evaluate.ts` 重写为角色重打分；`checkGroup` 走硬筛 → LLM → severity；Advanced tab 重新布局。 | 1 天 |
| **P3** | 9 → 5 角色 preset 改写 + 自定义 preset UI 微调；i18n 补齐。 | 0.5 天 |
| **P4** | storeVersion v4 迁移；README 重写（首屏是 Tier 1 截图）；回归测试。 | 0.5 天 |

**总计 3.5 天。P0 + P1 合计 1.5 天就能单独发 "v2 basic-first" 版本**——面向不配 LLM 的新用户，引流即见效。

---

## 八、验证清单

### Tier 1 验证
1. 只填 FreeNews API Key，`aiEnabled=false`，监控"英伟达"：
   - 一条 `importanceScore=9` 的英伟达重大新闻 → 触发 high severity 告警（旧版本除非情感极差，否则不告警）
   - 一条 `importanceScore=2, sentimentScore=0.4` 的英伟达日常评论 → 不告警
2. Settings basic tab 完全不显示任何 LLM 配置项
3. `aiEnabled=false` 时 `ai-evaluate.ts` 零调用（可通过日志确认）

### Tier 2 验证
4. 切到 advanced tab，开启 OSINT 角色，监控"台海":
   - 一条"台湾军演结束"中性新闻 `importance=6` → 硬筛不过，LLM 不调用
   - 一条"解放军异常调动" `importance=8` → 硬筛过 → LLM 判定 `roleRelevance=0.9` → 高级告警
   - 一条"台湾旅游业数据" `importance=8` → 硬筛过 → LLM 判定 `roleRelevance=0.2` → 不告警
5. 同一条新闻切换到"金融投资者"角色：reasoning 内容明显不同，relevance 分数也不同
6. LLM 请求失败 / 超时：降级到纯 Tier 1 规则，**不静默丢失告警**

### 回归
7. 旧用户（storeVersion=3）升级后：`aiPrescreenThreshold` 正确映射到 `negativeSentimentThreshold`
8. 冷却期、去重、TopicRun 记录功能行为与旧版一致

---

## 九、README 重写要点（P4 阶段）

首屏应该是这样的顺序：

1. 一行 GIF / 截图：**"配一个 API Key，30 秒收到你关心关键词的重要新闻"**
2. `npm install` → 打开 → 填 FreeNews API Key（附引流链接到 freenews.site）→ 添加关键词 → 完
3. 小字说明：想要 AI 角色化判断？打开"高级设置" tab 配置

把"配 OpenAI / Anthropic"的内容从 README 首屏完全移除——它属于高级章节。

---

## 十、开工顺序建议

1. 先 P0（纯字段扩展 + UI 展示）——合进主分支，让你自己用一段时间积累 importance 真实数据分布
2. 根据 1 的观察确认 `importanceThreshold=7` 是否合适，必要时微调默认值
3. P1 开始走 Tier 1 闭环
4. P2+ 改 LLM 路径

如果这个 plan 方向你同意，下一步我就从 P0 开始动手改代码。
