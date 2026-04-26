# Plan: AI 高级分析功能

## Context

FreeNews Sentinel 目前的新闻评估完全依赖 FreeNews API 返回的情感分数（0-1），通过阈值触发警报。用户希望接入大语言模型，让不同"角色/人设"对新闻进行二次评估——比如地缘政治专家、股票投资者、加密货币交易员会对同一条新闻给出完全不同的判断。

**现状**：代码中 AI 相关的数据结构（`aiReasoning`、`aiImpact`、`aiUrgency`、`aiRelevance`、`LLMResult`、`customPrompt`）已经定义好但全部为空/null。Settings 高级设置 tab 是占位 stub。`buildTopicRunArticles()` 已经能正确映射 `LLMResult` 到文章字段。基础设施 80% 到位，需要把管道打通。

---

## 整体流程

```
[设置页] 启用AI → 配置 Provider/Key/Model
                              ↓
[主题管理] 每个主题组选择"分析角色"（preset 或自定义）
                              ↓
[监控循环] FreeNews API 返回文章 → 筛出新文章 → 发给 LLM 二次评估
                              ↓
         LLM 返回: relevance / impact / urgency / trigger_alert / reasoning
                              ↓
         用 LLM 结果决定是否触发警报（替代纯情感分阈值）
```

---

## 文件变更清单

### 1. `src/main/store.ts` — Settings 新增字段

```typescript
// Settings 接口新增：
aiEnabled: boolean              // 总开关，默认 false
aiProviderType: 'openai' | 'anthropic'  // 默认 'openai'
```

- 加到 `Settings` interface
- 加到 `defaults.settings`
- `CURRENT_STORE_VERSION` 保持 2（字段兼容，不需要清数据）

> `aiBaseUrl`、`aiApiKey`、`aiModel`、`aiPromptPrefix` 已存在，不需要改。

### 2. `src/renderer/src/store/index.ts` — 镜像新增字段

在 renderer 的 `Settings` interface 和默认值中同步添加 `aiEnabled` 和 `aiProviderType`。

### 3. `src/renderer/src/constants.ts` — 添加 Anthropic 预设

```typescript
AI_PROVIDER_PRESETS 新增：
{
  label: 'Anthropic',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-20250514',
  note: 'Anthropic Messages API',
  providerType: 'anthropic'  // 新增字段区分类型
}
```

给现有 preset 也加上 `providerType: 'openai'`。

### 4. `src/main/ai-evaluate.ts` — 新文件，AI 评估引擎

核心模块，负责与 LLM 通信：

```typescript
// 判断 AI 是否就绪
function isAiReady(settings): boolean
  → aiEnabled && aiApiKey && aiModel

// 解析 customPrompt 字段为实际 prompt 文本
function resolveSystemPrompt(customPrompt: string, settings): string
  → 'preset:N' → PROMPT_PRESETS[N].value
  → 'custom:N' → settings.customPresets[N].value
  → ''         → settings.aiPromptPrefix（全局默认）

// 批量评估文章
async function evaluateArticles(articles, systemPrompt, settings): Promise<LLMResult[]>
  → 每批最多 10 篇文章
  → 根据 aiProviderType 选择 OpenAI 或 Anthropic 请求格式
  → 解析 JSON 响应，提取 LLMResult[]
  → 失败时返回空数组（graceful degradation）
```

**LLM 返回结构**（已有 `LLMResult` 接口）：
| 字段 | 说明 |
|------|------|
| `index` | 文章序号（1-based） |
| `relevance` | 相关性 1-10 |
| `impact` | 影响力 -10 到 +10 |
| `urgency` | 紧急度 low/medium/high |
| `trigger_alert` | 是否触发警报 |
| `reasoning` | 1-2 句中文解释"这条信息改变了什么" |

**OpenAI 格式**：`POST {baseUrl}/chat/completions`，复用 `briefs.ts` 中已有的请求模式。

**Anthropic 格式**：`POST {baseUrl}/v1/messages`，用 `x-api-key` + `anthropic-version` header。

### 5. `src/main/monitor.ts` — 接入 AI 评估

在 `checkGroup()` 函数中，`newArticles` 筛出后、警报判断前，插入 AI 评估步骤：

```
行 520 附近，现有 `const llmResults: LLMResult[] = []` 改为：

if (isAiReady(settings) && evaluatedArticles.length > 0) {
  const prompt = resolveSystemPrompt(group.customPrompt, settings)
  llmResults = await evaluateArticles(evaluatedArticles, prompt, settings)
}
```

**警报判断逻辑修改**（行 522-530）：

```
if (llmResults.length > 0) {
  // AI 驱动：用 LLM 的 trigger_alert 决定
  const triggered = llmResults.filter(r => r.trigger_alert)
  if (triggered.length > 0) {
    worst = 按 impact 找最严重的
    newStatus = worst.urgency === 'high' ? 'alert' : 'warning'
    alertReason = worst.reasoning
  }
} else {
  // 原有逻辑：纯情感分阈值（不动）
}
```

**Alert 对象填充 AI 字段**（行 575-578）：
```
aiReasoning: matchedLlmResult?.reasoning ?? null
aiImpact: matchedLlmResult?.impact ?? null
aiUrgency: matchedLlmResult?.urgency ?? null
aiRelevance: matchedLlmResult?.relevance ?? null
```

> `buildTopicRunArticles()` 已经能自动映射 `llmResults` → `TopicRunArticle` 的 AI 字段，不需要改。

### 6. `src/main/index.ts` — 更新 IPC

- `get-settings`：默认值加 `aiEnabled: false, aiProviderType: 'openai'`
- `test-ai`：接收 `providerType` 参数，Anthropic 时用 Messages API 格式测试

### 7. `src/preload/index.ts` — testAi 签名更新

```typescript
testAi: (config: unknown) => ...  // config 中增加 providerType 字段
```

### 8. `src/renderer/src/pages/Settings.tsx` — 高级设置 UI

替换现有的占位 stub（行 400-435），构建完整的高级设置表单：

**区块 A：AI 总开关**
- Toggle 开关 → `aiEnabled`
- 关闭时下方所有内容 dimmed/disabled

**区块 B：模型配置**（aiEnabled 时显示）
- Provider 类型下拉：`OpenAI 兼容` | `Anthropic`
- 快速填充按钮行：OpenAI / Ollama / Anthropic / 自定义（点击自动填入 baseUrl + model + providerType）
- Base URL 输入框
- API Key 输入框（password）
- Model 输入框
- 测试连接按钮 → 调用 `window.api.testAi()`

**区块 C：默认分析角色**
- 下拉框选择 `PROMPT_PRESETS` 中的预设角色
- 选中后写入 `aiPromptPrefix`
- 可展开的 textarea 查看/编辑完整 prompt

### 9. `src/renderer/src/pages/Keywords.tsx` — 主题组角色选择

**条件渲染**：只在 `settings.aiEnabled && settings.aiApiKey` 时显示。

**编辑弹窗中**（阈值选择下方）：
- 新增"分析角色"下拉：
  - `使用全局默认` → customPrompt = ''
  - 9 个预设角色 → customPrompt = 'preset:0' ~ 'preset:8'
  - 用户自定义预设 → customPrompt = 'custom:0' ~ 'custom:N'
- 新增 state `rolePrompt`，保存时写入 group 内所有 keyword 的 `customPrompt`

**卡片展示中**：
- 当 AI 启用时，在卡片上显示当前角色标签（如 "🛰 OSINT"、"📈 股票"）

### 10. `src/renderer/src/i18n.ts` — 新增翻译 key

约 20+ 个新 key，覆盖：
- 设置页 AI 开关、Provider、模型配置、测试连接
- 默认角色选择
- 主题页角色选择器
- AI 评估状态提示

### 11. `src/renderer/src/presets.ts` — 无需修改

9 个预设角色已完整，直接引用 index。

---

## 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| API 格式 | 同时支持 OpenAI + Anthropic | 覆盖主流用户，用 `providerType` 显式切换 |
| 角色存储 | 复用 `customPrompt` 字段存 `preset:N` | 字段已存在且全链路贯通，无需改 IPC/schema |
| AI 失败策略 | 静默回退到情感分阈值 | 保证监控永不中断 |
| 文章批量大小 | 每批 10 篇 | 适配大部分模型上下文窗口 |

---

## 实施顺序

1. **Store + Settings 字段**（store.ts × 2, constants.ts）
2. **AI 引擎**（新建 ai-evaluate.ts）
3. **Monitor 接入**（monitor.ts）
4. **IPC 更新**（index.ts, preload/index.ts）
5. **i18n**（i18n.ts）
6. **Settings UI**（Settings.tsx）
7. **Keywords 角色选择**（Keywords.tsx）

---

## 验证方式

1. **类型检查**：`tsc --noEmit --project tsconfig.web.json` + `tsconfig.node.json`
2. **Settings 页面**：开启 AI → 填入 OpenAI key → 测试连接 → 选择默认角色 → 保存
3. **主题页面**：编辑主题组 → 看到角色选择器 → 选择不同角色 → 保存
4. **监控循环**：启动监控 → 等一轮 → 检查 topicRun 的 `recentArticles` 中 `aiReasoning` 等字段是否有值
5. **警报触发**：LLM 返回 `trigger_alert: true` 时应触发警报，且 alert 详情显示 AI 分析内容
6. **降级测试**：配置错误的 API key → AI 调用失败 → 应回退到纯情感分阈值，监控不中断
