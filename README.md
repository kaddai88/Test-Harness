# Test-Harness

> AI-driven website testing platform (DSH-style architecture). Describe what you want tested in natural language — an LLM agent plans, executes browser actions, and streams results in real-time.

![CI](https://github.com/kaddai88/Test_Harness_v2/actions/workflows/ci.yml/badge.svg)
![Tests](https://img.shields.io/badge/tests-34%20passing-brightgreen)
![Packages](https://img.shields.io/badge/packages-18-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-339933)
![pnpm](https://img.shields.io/badge/pnpm-10-F69220)
![License](https://img.shields.io/badge/license-MIT-blue)

 [中文文档](README.zh.md)

---

## Overview

Test-Harness is a production-grade, AI-driven website quality analysis platform
built as a TypeScript monorepo. It is architecturally inspired by
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and its
[Cordis](https://github.com/cordiverse/cordis) plugin framework:

**Everything is a plugin** — LLM adapters, tools, storage backends compose through a unified plugin container.

### Key Features

- **AI Agent Loop** — LLM decides what to test, in what order, and how to interpret results (DSH-style architecture with SessionLog, waterfall events, Turn→Step pipeline)
- **Session Log** — Append-only event log; all model-visible content is reconstructable from the log
- **Waterfall Events** — Around-middleware at every pipeline stage (pre-step, request, pre/post-execute)
- **Streaming LLM** — Real-time terminal and WebSocket progress during tests
- **Browser Automation** — navigate, click, fill, screenshot, assert (Playwright via MCP or local)
- **Playwright MCP** — Connect to @playwright/mcp server for standardized browser automation
- **Generalization Layer** — Cross-site testing without hardcoded selectors: DOM distillation (50k→200-500 elements), SmartLocator (5-level fallback), SiteProfile (self-learning site knowledge), observe→find→act paradigm
- **Self-Learning Site Profiles** — Automatically discovers auth/form/navigation patterns from session history; persists across sessions for faster, more reliable future tests
- **Multiple LLM Providers** — OpenAI-compatible APIs, Ollama (local), DeepSeek with failover support
- **Full Web Platform** — REST API + WebSocket + React Dashboard
- **Production Ready** — Graceful shutdown, rate limiting, Docker deployment, CI/CD

### Current Configuration

| Component | Value |
|-----------|-------|
| **LLM Provider** | OpenAI-compatible API |
| **Model** | minimax/minimax-m2.7-free |
| **Browser Mode** | Playwright MCP (`BROWSER_MODE=mcp`) |
| **MCP Server** | `@playwright/mcp` on `http://localhost:3001/mcp` |

### Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           Client Layer                                   │
│   CLI (th test)    React Dashboard    REST API    WebSocket (real-time) │
└──────────┬──────────────┬──────────────────┬───────────────┬────────────┘
           │              │                  │               │
           ▼              ▼                  ▼               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        th-agent  (Agent Loop)                            │
│                                                                          │
│  ┌─────────┐   ┌─────────┐   ┌───────────┐   ┌──────────┐              │
│  │  Turn   │──▶│  Step   │──▶│   Model   │──▶│  Tool    │──┐           │
│  │  Start  │   │  Start  │   │  Request  │   │  Calls   │  │           │
│  └─────────┘   └─────────┘   └───────────┘   └──────────┘  │           │
│       ▲                                               │      │           │
│       │            ┌───────────┐                      │      │           │
│       └────────────│  Tool     │◀─────────────────────┘      │           │
│                    │  Results  │                              │           │
│                    └───────────┘                              │           │
│  Waterfall: pre_step → request → stream → pre_execute → post_execute    │
│  Session Log: append-only, deriveMessages(), fully replayable           │
└──────────┬──────────────────────────────────────────────────────────────┘
           │
     ┌─────┬─────────────┬──────────┐
     ▼     ▼             ▼          ▼
┌────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐
│  LLM   │ │ Tools    │ │Browser │ │  Report  │
│Provider│ │ Registry │ │ Driver │ │Generator │
│        │ │          │ │        │ │          │
│┌──────┐│ │┌──────┐ │ │┌──────┐│ │┌───────┐│
││Ollama││ ││nav   │ │ ││Play- ││ ││ JSON  ││
││OpenAI││ ││click │ │ ││wright││ ││  MD   ││
││Qwen  ││ ││fill  │ │ ││ MCP  ││ ││ HTML  ││
││Stub  ││ ││assert│ │ │└──────┘│ │└───────┘│
│└──────┘│ ││screen│ │ │        │ │          │
│        │ ││http  │ │ │        │ │          │
│        │ ││report│ │ │        │ │          │
│        │ │└──────┘ │ │        │ │          │
└────────┘ └──────────┘ └────────┘ └──────────┘
     ┌─────────────────────────────────────────────────┐
     │              th-core  (Plugin Framework)         │
     │  ┌───────────┐ ┌────────┐ ┌───────┐ ┌────────┐ │
     │  │ Container │ │ Events │ │ Effect│ │ Plugin │ │
     │  │   (DI)    │ │  Bus   │ │ Stack │ │ Loader │ │
     │  │           │ │4 modes │ │       │ │        │ │
     │  └───────────┘ └────────┘ └───────┘ └────────┘ │
     └─────────────────────────────────────────────────┘
     ┌─────────────────────────────────────────────────┐
     │            Storage & Transport                   │
     │  th-persistence   th-queue    th-worker         │
     │  (SQLite/PG)      (BullMQ)   (Job processors)   │
     └─────────────────────────────────────────────────┘
```

## Quick Start

### CLI

```bash
# Install dependencies
pnpm install

# Start Ollama (or set OPENAI_API_KEY / DEEPSEEK_API_KEY)
ollama pull llama3.1

# Start a test session
pnpm --filter @test-harness/th-cli test https://example.com --instructions "Test the login page"

# Scan a whole site
pnpm --filter @test-harness/th-cli test https://example.com --instructions "Explore the whole site"

# Use a different LLM provider
pnpm --filter @test-harness/th-cli test https://example.com --provider openai --model gpt-4o
```

### Server + Dashboard

```bash
# Start the server (API + Worker + Database)
node apps/server/th-server/dist/index.js
# → REST API: http://localhost:3000/api/v1
# → Health:   http://localhost:3000/api/v1/health

# Start the React Dashboard (development)
pnpm --filter @test-harness/th-dashboard dev
# → Dashboard: http://localhost:5173

# Start a session via API
curl -X POST http://localhost:3000/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"targetUrl":"https://example.com","scanConfig":{"instructions":"Test the login page"}}'

# Watch real-time progress via WebSocket
# ws://localhost:3000/ws
```

### Docker

```bash
docker compose up -d            # server on :3000, Ollama on :11434
docker compose logs -f server
```

### Tests

```bash
npx vitest run                  # 70 tests across 6 suites
```

See [docs/API.md](docs/API.md) for the full REST + WebSocket endpoint reference.

## Package Inventory

### Applications

| Package | Path | Description |
|---|---|---|
| `@test-harness/th-server` | `apps/server/th-server` | Production server (REST + WebSocket + Worker) |
| `@test-harness/th-dashboard` | `apps/web/th-dashboard` | React 18 SPA (Vite + Tailwind + Zustand) |
| `@test-harness/th-cli` | `packages/cli/th-cli` | CLI: `th scan <url>` |

### Framework Core

| Package | Path | Description |
|---|---|---|
| `@test-harness/th-protocol` | `packages/protocol/th-protocol` | Shared types + event definitions |
| `@test-harness/th-core` | `packages/core/th-core` | Plugin framework: DI, events (4 modes), effects |
| `@test-harness/th-agent` | `packages/agent/th-agent` | Agent Loop + Session Log + Stream Assembler |

### LLM Adapters

| Package | Provider | Features |
|---|---|---|
| `@test-harness/th-llm` | Abstract seam | Router, capability negotiation |
| `@test-harness/th-llm-ollama` | [Ollama](https://ollama.ai) | Local models, streaming, tool calls |
| `@test-harness/th-llm-openai` | OpenAI | GPT-4o, streaming, function calling |
| `@test-harness/th-llm-deepseek` | DeepSeek | V3/R1, OpenAI-compatible |

### Tools & Browser

| Package | Description |
|---|---|
| `@test-harness/th-tools` | Tool framework + 16 built-in tools: browser/HTTP + generalization (observe_page, find_element, extract_data, explore_site, configure_site) |
| `@test-harness/th-browser` | Browser capability seam + Playwright MCP + Generalization Layer (DOM distillation, SmartLocator, SiteProfile, cross-session cache persistence) |

### Infrastructure

| Package | Path | Description |
|---|---|---|
| `@test-harness/th-persistence` | `packages/persistence/th-persistence` | Session storage (JSON file / in-memory) |
| `@test-harness/th-queue` | `packages/queue/th-queue` | In-process task queue (test:execute, test:report jobs) |
| `@test-harness/th-worker` | `packages/worker/th-worker` | Test session job processor |
| `@test-harness/th-report` | `packages/report/th-report` | Report generator (JSON / Markdown / HTML) |
| `@test-harness/th-api` | `packages/api/th-api` | REST API (sessions, reports, health) + WebSocket gateway |

## Documentation

| Document | Description |
|---|---|
| [Contributing](CONTRIBUTING.md) | Setup, conventions, how to add plugins |
| [API Reference](docs/API.md) | REST + WebSocket endpoints with examples |
| [Plugin Dev Guide](docs/PLUGIN-DEV.md) | Write tools / LLM adapters / storage backends |
| [DSH Analysis](docs/DSH-ANALYSIS.md) | DeepSeek Harness architecture deep dive |
| [Progress Report](docs/PROGRESS-REPORT.md) | Implementation plan and status |

## Development

```bash
pnpm install                 # install deps
pnpm run build               # build all packages
pnpm run typecheck           # type-check all packages
npx vitest run               # run all tests
pnpm run clean               # remove all dist/ folders
```

Requires **Node 20+** and **pnpm 10** (managed by corepack).

## Project Status

All 5 phases complete — **production-ready**:

| Phase | Scope | Packages | Status |
|---|---|---|---|
| **Phase 1** | Foundation | 10 | ✅ Complete |
| **Phase 2** | Core Enhancement | 16 | ✅ Complete |
| **Phase 3** | Web Platform | 21 | ✅ Complete |
| **Phase 4** | Production Hardening | 22 | ✅ Complete |
| **Phase 5** | Generalization Layer | 18 | ✅ Complete |

### What's Done

- ✅ Plugin framework (DI container, 4-mode event bus, effect system)
- ✅ Agent Loop with Session Log, Waterfall events, Streaming LLM
- ✅ 3-stage tool execution pipeline with timeout control
- ✅ 3 LLM adapters (Ollama, OpenAI, DeepSeek) with failover
- ✅ 16 built-in tools including 5 generalization tools (observe_page, find_element, extract_data, explore_site, configure_site)
- ✅ Generalization Layer: DOM distillation, SmartLocator (5-level fallback), SiteProfile self-learning
- ✅ Cross-session cache persistence — selectors learned in one session are reused in the next
- ✅ observe→find→act paradigm — agent discovers pages semantically instead of hardcoded CSS/XPath
- ✅ REST API (9 endpoints) + WebSocket real-time gateway
- ✅ React Dashboard (6 pages, real-time scan progress)
- ✅ JSON file persistence with repository pattern
- ✅ Task queue with priority and retry
- ✅ Report generation (JSON / Markdown / HTML)
- ✅ Graceful shutdown, rate limiting, Docker deployment
- ✅ GitHub Actions CI/CD (Node 20 + 22 matrix)
- ✅ 70 passing unit tests
- ✅ Comprehensive documentation (API, Plugin Dev Guide, Contributing)

### What's Next (Future)

- 📋 PostgreSQL provider (production database)
- 📋 BullMQ + Redis (distributed task queue)
- 📋 JWT authentication + multi-tenant support
- 📋 Kubernetes manifests + Helm charts
- 📋 Scheduled scans + scan comparison
- 📋 White-label reports
- 📋 Test intent DSL / natural language test case parsing
- 📋 Adaptive exploration strategy (WebProber-style)
- 📋 Anti-bot / proxy support

## License

MIT
