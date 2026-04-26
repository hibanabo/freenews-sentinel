<div align="center">

<h1>FreeNews Sentinel</h1>

<p>
  <strong>AI-powered news monitoring desktop app · AI 驱动的新闻舆情监控桌面应用</strong>
</p>

<p>
  <a href="#"><img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" /></a>
  <a href="#"><img src="https://img.shields.io/badge/built%20with-Electron%20%2B%20React-47848F?logo=electron&logoColor=white" /></a>
  <a href="#"><img src="https://img.shields.io/badge/AI-OpenAI%20%7C%20Anthropic-8A2BE2" /></a>
</p>

<p>
  Track any topic · Detect risk signals · Get instant alerts<br/>
  追踪任意主题 · 识别风险信号 · 即时推送预警
</p>

<img src="docs/screenshot-dashboard.png" width="780" alt="Dashboard" />

</div>

---

## Features · 功能特性

| | EN | 中文 |
|---|---|---|
| 🛰️ | **Topic Monitoring** — boolean query expressions, batch management | **主题监控** — 布尔查询表达式，批量管理 |
| 📉 | **Sentiment Analysis** — real-time scoring (0~1) with thresholds | **情感分析** — 实时评分，可配置阈值 |
| 🤖 | **AI Decision Layer** — `threshold` / `hybrid` / `llm_only` modes | **AI 决策层** — 纯阈值 / 混合 / 纯 LLM 三种模式 |
| 🎭 | **9 Analysis Roles** — OSINT, Stock, Crypto, PR, Tech… | **9 种分析角色** — OSINT、股票、加密、公关、科技… |
| 🔔 | **Smart Alerts** — severity levels, cooldown, native OS notifications | **智能预警** — 严重等级、冷却控制、系统原生通知 |
| 📰 | **Auto Briefing** — scheduled AI-generated summaries | **自动简报** — 定时生成 AI 新闻摘要 |
| 🔒 | **Secure by Design** — API keys in OS keychain, context isolation | **安全设计** — 密钥存入系统钥匙串，进程隔离 |
| 🌐 | **Bilingual UI** — Chinese / English, Dark / Light theme | **双语界面** — 中英文，深色/浅色主题 |

---

## Quick Start · 快速开始

**Download a release (recommended) · 下载安装包（推荐）**

→ [Releases](https://github.com/hibanabo/freenews-sentinel/releases) — macOS `.dmg` · Windows `.exe` · Linux `.AppImage`

**Or build from source · 或从源码构建**

```bash
git clone https://github.com/hibanabo/freenews-sentinel.git
cd freenews-sentinel
npm install
npm run dev
```

```bash
# Package for your platform · 打包当前平台
npm run package:mac    # macOS
npm run package:win    # Windows
npm run package:linux  # Linux
```

---

## Setup · 配置

1. Get a free API Key at **[freenews.site](https://freenews.site)**
2. Open the app → **Settings** → enter your **FreeNews API Key**
3. *(Optional)* Enable **AI Analysis** → configure OpenAI or Anthropic
4. Go to **Keywords** → create a topic group → monitoring starts automatically

> 1. 在 **[freenews.site](https://freenews.site)** 注册获取免费 API Key
> 2. 打开应用 → **设置** → 填入 **FreeNews API Key**
> 3. （可选）开启 **AI 分析** → 配置 OpenAI 或 Anthropic
> 4. 进入 **主题管理** → 创建主题组 → 监控自动启动

---

## Tech Stack · 技术栈

`Electron` · `React` · `TypeScript` · `Zustand` · `SQLite (better-sqlite3)` · `keytar` · `electron-vite`

**Data flow:** Topic config → FreeNews API → SQLite → Threshold / LLM evaluation → Alert → IPC → UI

---

## Contributing · 参与贡献

1. Fork → create a feature branch
2. Follow existing code style — TypeScript strict, `camelCase` vars, `PascalCase` components
3. Run `npm run build` before submitting a PR
4. Update `src/renderer/src/i18n.ts` for any user-facing text

---

## License

[MIT](LICENSE) © 2026 FreeNews
