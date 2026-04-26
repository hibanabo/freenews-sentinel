<div align="center">

# FreeNews Sentinel

**AI-Powered Global News Monitoring & Sentiment Alert System**

**AI 驱动的全球新闻舆情监控与智能预警系统**

[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)](#)
[![License](https://img.shields.io/badge/license-MIT-green)](#license)
[![Electron](https://img.shields.io/badge/Electron-React-47848F?logo=electron&logoColor=white)](#)
[![AI](https://img.shields.io/badge/AI-OpenAI%20%7C%20Anthropic-8A2BE2)](#)

Real-time news intelligence with LLM-powered analysis. Track any topic, detect risk signals, get instant alerts.

实时新闻情报 + 大模型深度分析。追踪任意主题，识别风险信号，即时推送预警。

[**English**](#english) | [**中文**](#中文)

<img src="docs/screenshot-dashboard.png" width="800" alt="Dashboard — 仪表盘" />
<img src="docs/screenshot-alert-detail.png" width="800" alt="Alert Detail — 警报详情" />

</div>

---

<a id="english"></a>

## English

### Why FreeNews Sentinel?

Most news monitoring tools are either expensive SaaS platforms or simple RSS readers. FreeNews Sentinel fills the gap:

- **Free & open source** — no subscription, no data leaves your machine
- **AI-native** — not just keyword matching; LLMs evaluate relevance, impact, and urgency
- **Role-based analysis** — the same news gets different scores from a stock trader vs. a geopolitical analyst
- **Local-first** — SQLite + OS keychain, your data stays on your device

### Features

| | Feature | Description |
|---|---------|-------------|
| :satellite: | **Topic Monitoring** | Boolean query expressions, batch topic management |
| :chart_with_downwards_trend: | **Sentiment Analysis** | Real-time sentiment scoring (0~1) with configurable thresholds |
| :robot: | **AI Decision Layer** | `threshold_only` / `hybrid` / `llm_only` modes with OpenAI & Anthropic support |
| :performing_arts: | **9 Analysis Roles** | OSINT, Stock, Crypto, PR, Tech, Supply Chain, Media, Compliance, General |
| :bell: | **Smart Alerts** | Severity levels, cooldown control, native OS notifications |
| :newspaper: | **Auto Briefing** | Scheduled AI-generated news summaries |
| :art: | **Dark / Light Theme** | Full theme support with one-click toggle |
| :globe_with_meridians: | **Bilingual UI** | Chinese / English interface |
| :lock: | **Secure by Design** | API keys in OS keychain, parameterized SQL, context isolation |

### Tech Stack

`Electron` `React` `TypeScript` `Zustand` `SQLite` `better-sqlite3` `keytar` `electron-vite`

### Quick Start

```bash
git clone https://github.com/hibanabo/freenews-sentinel.git
cd freenews-sentinel
npm install
npm run dev
```

Build & package:

```bash
npm run build
npm run package:mac    # or package:win / package:linux
```

### Configuration

1. Launch the app → go to **Settings**
2. Enter your **FreeNews API Key** (required)
3. Optionally enable **AI Analysis** → configure OpenAI or Anthropic provider
4. Create topic groups in **Keywords** page → start monitoring

### Architecture

```
src/
  main/           # Electron main process
    ├── monitor.ts       # Scheduled monitoring & alert decisions
    ├── ai-evaluate.ts   # LLM integration (OpenAI / Anthropic)
    ├── db.ts            # SQLite schema & data access
    ├── secrets.ts       # OS keychain integration
    └── constants.ts     # Shared constants
  preload/         # Typed IPC bridge (contextIsolation: true)
  renderer/        # React UI + Zustand state
    ├── pages/           # Dashboard, Keywords, Alerts, Brief, Settings
    ├── components/      # Sidebar, Topbar
    └── i18n.ts          # Bilingual translations
```

**Data flow:** Topic config → FreeNews API search → article normalization → SQLite storage → threshold / LLM evaluation → alert generation → IPC push to UI

**Storage:** SQLite for business data, `electron-store` for settings, `keytar` for API secrets

### Contributing

1. Fork & create a feature branch
2. Follow existing code style (TypeScript strict, `camelCase` vars, `PascalCase` components)
3. Run `npm run build` before submitting PR
4. Update i18n strings for user-facing text changes

---

<a id="中文"></a>

## 中文

### 为什么选择 FreeNews Sentinel？

市面上的新闻监控工具要么是昂贵的 SaaS，要么是简单的 RSS 阅读器。FreeNews Sentinel 填补了空白：

- **免费开源** — 无需订阅，数据不离开你的电脑
- **AI 原生** — 不只是关键词匹配，大语言模型评估相关性、影响力和紧急度
- **角色化分析** — 同一条新闻，股票交易员和地缘政治分析师会给出完全不同的评分
- **本地优先** — SQLite + 系统钥匙串，数据留在你的设备上

### 功能特性

| | 功能 | 说明 |
|---|------|------|
| :satellite: | **主题监控** | 布尔查询表达式，批量主题管理 |
| :chart_with_downwards_trend: | **情感分析** | 实时情感评分（0~1），可配置阈值 |
| :robot: | **AI 决策层** | `纯阈值` / `混合模式` / `纯 LLM`，支持 OpenAI 和 Anthropic |
| :performing_arts: | **9 种分析角色** | OSINT、股票、加密货币、公关、科技、供应链、媒体、合规、通用 |
| :bell: | **智能预警** | 严重等级、冷却控制、系统原生通知 |
| :newspaper: | **自动简报** | 定时生成 AI 新闻摘要 |
| :art: | **深色/浅色主题** | 完整主题支持，一键切换 |
| :globe_with_meridians: | **双语界面** | 中文 / 英文 |
| :lock: | **安全设计** | API 密钥存入系统钥匙串，参数化 SQL，进程隔离 |

### 技术栈

`Electron` `React` `TypeScript` `Zustand` `SQLite` `better-sqlite3` `keytar` `electron-vite`

### 快速开始

```bash
git clone https://github.com/hibanabo/freenews-sentinel.git
cd freenews-sentinel
npm install
npm run dev
```

构建 & 打包：

```bash
npm run build
npm run package:mac    # 或 package:win / package:linux
```

### 配置指南

1. 启动应用 → 进入 **设置**
2. 填入 **FreeNews API Key**（必须）
3. 可选开启 **AI 分析** → 配置 OpenAI 或 Anthropic
4. 在 **主题管理** 页面创建主题组 → 开始监控

### 架构概览

```
src/
  main/           # Electron 主进程
    ├── monitor.ts       # 定时监控与预警决策
    ├── ai-evaluate.ts   # LLM 集成（OpenAI / Anthropic）
    ├── db.ts            # SQLite 表结构与数据访问
    ├── secrets.ts       # 系统钥匙串集成
    └── constants.ts     # 共享常量
  preload/         # 类型化 IPC 桥接（contextIsolation: true）
  renderer/        # React UI + Zustand 状态管理
    ├── pages/           # 仪表盘、主题管理、警报、简报、设置
    ├── components/      # 侧边栏、顶栏
    └── i18n.ts          # 中英双语翻译
```

**数据流：** 主题配置 → FreeNews API 搜索 → 文章标准化 → SQLite 存储 → 阈值/LLM 评估 → 生成警报 → IPC 推送至 UI

**存储：** SQLite 存业务数据，`electron-store` 存设置，`keytar` 存 API 密钥

### 参与贡献

1. Fork 并创建功能分支
2. 遵循现有代码风格（TypeScript strict，`camelCase` 变量，`PascalCase` 组件）
3. 提交 PR 前运行 `npm run build`
4. 涉及用户可见文本时同步更新 i18n

---

## Changelog

### [1.0.0] - 2026-04-26

- FreeNews API integration for global news monitoring
- Topic-based keyword group management with batch operations
- Real-time sentiment analysis and threshold-based alerts
- AI-powered deep analysis with role-based evaluation (OpenAI + Anthropic)
- Automated brief generation, Dark/Light theme, bilingual UI
- Cross-platform support (macOS, Windows, Linux)
- Secure credential storage via OS keychain

## License

[MIT](LICENSE)
