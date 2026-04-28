# Contributing to FreeNews Sentinel

Thanks for your interest! Whether you're filing a bug, suggesting a persona, or sending a PR — every bit of feedback shapes where this project goes.

This document covers everything you need to be a productive contributor in 10 minutes.

## Table of contents

- [Ways to contribute](#ways-to-contribute)
- [Development environment](#development-environment)
- [Project structure](#project-structure)
- [Code style](#code-style)
- [Internationalization (i18n)](#internationalization-i18n)
- [Adding an analyst persona](#adding-an-analyst-persona)
- [Database migrations](#database-migrations)
- [Pull request flow](#pull-request-flow)
- [Reporting security issues](#reporting-security-issues)

---

## Ways to contribute

| If you have… | Do this |
|---|---|
| A bug to report | [Open a bug issue](https://github.com/hibanabo/freenews-sentinel/issues/new?template=bug_report.yml) |
| A feature idea | [Open a feature issue](https://github.com/hibanabo/freenews-sentinel/issues/new?template=feature_request.yml) — describe the **problem** first, not the solution |
| A usage question | [Start a Discussion](https://github.com/hibanabo/freenews-sentinel/discussions) — issues are for confirmed bugs / concrete features |
| A code change | Fork → branch → PR (details below) |
| A new analyst persona | See [Adding an analyst persona](#adding-an-analyst-persona) — this is one of the most welcome contributions |

---

## Development environment

**Prerequisites**:

- Node.js **20.x LTS** (Electron 31 ships with Node 20). Earlier versions may work but aren't supported.
- A C/C++ toolchain for `better-sqlite3` and `keytar` native rebuilds:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Windows**: Visual Studio Build Tools (Desktop development with C++)
  - **Linux**: `build-essential libsecret-1-dev`

**Setup**:

```bash
git clone https://github.com/hibanabo/freenews-sentinel.git
cd freenews-sentinel
npm install            # also runs electron-builder install-app-deps
npm run dev            # starts electron-vite in watch mode
```

**Useful scripts**:

| Script | What it does |
|---|---|
| `npm run dev` | Start the app with hot-reload |
| `npm run build` | Production bundle (no packaging) |
| `npm run typecheck` | TS check for both main and renderer |
| `npm run check` | Typecheck + build — **run this before every PR** |
| `npm run lint` | ESLint over `src/**` |
| `npm run format` | Prettier rewrite |
| `npm run package:mac` / `:win` / `:linux` | Build a distributable installer |

---

## Project structure

```
src/
├── main/              # Electron main process (Node)
│   ├── index.ts       # App entry, window lifecycle
│   ├── ipc.ts         # IPC handlers — the API surface for the renderer
│   ├── monitor.ts     # Scheduled news polling
│   ├── ai-evaluate.ts # LLM scoring (OpenAI / Anthropic / local)
│   ├── briefs.ts      # AI-generated periodic briefings
│   ├── db.ts          # SQLite schema + migrations
│   ├── secrets.ts     # OS keychain access (keytar)
│   └── store.ts       # Settings (electron-store)
├── preload/           # Preload script — bridges main ↔ renderer safely
└── renderer/src/
    ├── pages/         # Top-level routes: Dashboard, Keywords, Alerts, Brief, Settings
    ├── components/    # Reusable UI
    ├── store/         # Zustand stores
    ├── i18n.ts        # Bilingual strings — see below
    └── presets.ts     # 9 built-in analyst personas
```

When in doubt, the IPC contract in [`src/main/ipc.ts`](src/main/ipc.ts) is the canonical list of "what the app can do."

---

## Code style

- **TypeScript strict** — no `any` without a comment explaining why.
- Variables and functions: `camelCase`. React components: `PascalCase`. Files containing components: `PascalCase.tsx`.
- React: function components + hooks. Side effects in `useEffect`; long-running work goes through IPC to the main process.
- Don't add new runtime dependencies casually — if you do, justify it in your PR description.
- ESLint and Prettier configs are checked in; respect them. `npm run format` before committing is fine.

---

## Internationalization (i18n)

Every user-visible string lives in [`src/renderer/src/i18n.ts`](src/renderer/src/i18n.ts) under two parallel keysets: `zh` (Simplified Chinese) and `en`.

**Rule**: when you add or change a UI string, update **both** `zh` and `en` keys. PRs that touch only one language will be asked to add the other.

```ts
// src/renderer/src/i18n.ts
const zh = {
  alert_score_label: '风险评分',
  // ...
}
const en: typeof zh = {
  alert_score_label: 'Risk score',
  // ...
}
```

The `typeof zh` annotation on `en` enforces parity at compile time — `npm run typecheck` will fail if you forget a key.

In components, read strings via the `useT()` hook:

```tsx
const { t } = useT()
return <span>{t.alert_score_label}</span>
```

---

## Adding an analyst persona

The 9 built-in personas live in [`src/renderer/src/presets.ts`](src/renderer/src/presets.ts) as a single exported array. Each entry has:

- `label`: short display name with an emoji prefix
- `value`: the system prompt (Chinese-first, since most personas are domain-specific to Chinese-language financial / regulatory contexts)

To add a new one:

1. Append a new object to the `PROMPT_PRESETS` array.
2. Write a system prompt that is **specific to a real role**, not a generic "you are an assistant." The good ones describe the role's daily pressures and decision criteria — that's what makes the LLM produce useful judgments instead of summaries.
3. The prompt should ask the model to score along the existing dimensions: relevance, sentiment, impact magnitude, impact direction, urgency. Look at existing entries for the structure.
4. Test the new persona in the running app: Settings → AI Analysis → set persona → trigger a topic poll → check the alert detail panel for sane output.

---

## Database migrations

Schema changes go in [`src/main/db.ts`](src/main/db.ts). The project uses an **idempotent additive pattern** — there is no version counter; every migration must be safe to run on any DB state.

- New tables: append a `CREATE TABLE IF NOT EXISTS …` block in `initSchema`.
- New columns: use the `addColumnIfMissing(sql)` helper:

```ts
addColumnIfMissing(`ALTER TABLE articles ADD COLUMN your_new_field TEXT`)
```

- **Never rename or drop columns** without a deprecation path — there are users with months of historical data.
- If you need to reshape data, write a one-shot migration that detects "old shape" and rewrites in place; make it safe to re-run.

Test against a non-empty DB by running the app once on `main`, then switching to your branch and confirming startup still works.

---

## Pull request flow

1. **Fork** and create a feature branch: `git checkout -b feat/persona-real-estate` or `fix/notification-blank-window`.
2. **Code** + **add/update i18n keys** + **run** `npm run check`.
3. **Commit** in small, logical chunks. Conventional-commits style is appreciated but not enforced (`feat:`, `fix:`, `docs:`, `refactor:`).
4. **Open a PR** against `main`. The PR template will prompt you for the relevant fields.
5. **Wait for review** — small focused PRs get merged faster. If your PR has been stale for >5 days, comment to nudge.

**What gets PRs merged faster**:

- Linked issue + clear description of the user-visible problem.
- Screenshots / GIFs for any UI change.
- Tests where they make sense (the project has limited testing today; new tests are very welcome).
- Bilingual i18n updated.

---

## Reporting security issues

**Do not** open a public issue for security vulnerabilities (especially anything around the `keytar` keychain integration, IPC validation, or arbitrary URL handling).

Email the maintainer at the address listed in [`package.json`](package.json) `author.email`, with subject `[Security] FreeNews Sentinel – <short description>`. We'll respond within 7 days and credit you on the fix release if you'd like.

---

Thanks again — see you in the PR queue. 🛰
