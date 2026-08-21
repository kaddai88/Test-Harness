# Test-Harness

> AI 驱动的网站质量检测平台。爬取网站，运行安全 / 性能 / SEO / 无障碍检测，
> 让 LLM 智能体自动编排扫描流程并汇总检测结果。

![CI](https://github.com/<your-org>/test-harness/actions/workflows/ci.yml/badge.svg)
![Tests](https://img.shields.io/badge/tests-84%20passing-brightgreen)
![Packages](https://img.shields.io/badge/packages-22-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-339933)
![pnpm](https://img.shields.io/badge/pnpm-10-F69220)
![License](https://img.shields.io/badge/license-MIT-blue)

🌐 [English](README.md)

---

## 概述

Test-Harness 是一个生产级的、AI 驱动的网站质量检测平台，采用 TypeScript monorepo 构建。
架构设计灵感来源于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 及其
[Cordis](https://github.com/cordiverse/cordis) 插件框架：

**一切皆插件** — LLM 适配器、检测模块、工具、爬虫和存储后端都通过类型化的*服务定义*注册，
并通过 *waterfall* 扩展点进行拦截。

### 核心特性

- **AI Agent Loop** — LLM 智能决定运行哪些检测、何时运行、如何解读结果
- **Session Log** — 仅追加的事件日志；所有模型可见内容均可从日志中重建
- **Waterfall 事件** — 每个管线阶段都支持 around-middleware 拦截（pre-step、request、pre/post-execute）
- **LLM 流式输出** — 扫描过程中的实时终端和 WebSocket 进度推送
- **9 个检测插件** — 安全、性能、SEO、无障碍（共 22 个检测器）
- **3 个 LLM 适配器** — Ollama（本地）、OpenAI、DeepSeek，支持故障转移
- **完整 Web 平台** — REST API + WebSocket + React Dashboard
- **生产就绪** — 优雅停机、速率限制、Docker 部署、CI/CD

### 系统架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             客户端层                                      │
│   CLI (th scan)    React Dashboard    REST API    WebSocket (实时推送)    │
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
│  Session Log: 仅追加、deriveMessages()、完全可重放                         │
└──────────┬──────────────────────────────────────────────────────────────┘
           │
     ┌─────┼─────┬─────────────┬──────────────┐
     ▼     ▼     ▼             ▼              ▼
┌────────┐ ────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│  LLM   │ │ Tools  │ │Detection │ │  Crawl   │ │  Report  │
│Provider│ │Registry│ │ Registry │ │ Service  │ │Generator │
│        │ │        │ │          │ │          │ │          │
│┌──────┐│ │┌──────┐│ │┌───────┐ │ │┌───────┐ │ │───────┐│
││Ollama││ ││crawl ││ ││Sec(2) │ │ ││HTTP   │ │ ││ JSON  ││
││OpenAI││ ││extract││ ││Perf(2)│ │ ││Fetch  │ │ ││  MD   ││
││DeepSk││ ││http  ││ ││SEO (2)│ │ ││DOM    │ │ ││ HTML  ││
││Stub  ││ ││links ││ ││A11y(3)│ │ ││Robots │ │ │└───────┘│
│└──────│ ││detect││ │└───────┘ │ │└─────── │ │          │
└────────┘ │└──────┘│ └──────────┘ └──────────┘ └──────────┘
           └────────┘
     ┌─────────────────────────────────────────────────┐
     │              th-core  (插件框架)                 │
     │  ┌───────────┐ ┌────────┐ ┌───────┐ ┌────────┐ │
     │  │ Container │ │ Events │ │ Effect│ │ Plugin │ │
     │  │   (DI)    │ │  Bus   │ │ Stack │ │ Loader │ │
     │  │           │ │4 模式   │ │       │ │        │ │
     │  └───────────┘ └────────┘ └───────┘ └────────┘ │
     ─────────────────────────────────────────────────┘
     ┌─────────────────────────────────────────────────┐
     │              存储与传输                            │
     │  th-persistence   th-queue    th-worker         │
     │  (SQLite/PG)      (BullMQ)   (任务处理器)        │
     └─────────────────────────────────────────────────
```

## 快速开始

### CLI 命令行

```bash
# 安装依赖
pnpm install

# 启动 Ollama（或设置 OPENAI_API_KEY / DEEPSEEK_API_KEY）
ollama pull llama3.1

# 扫描单个页面
pnpm --filter @test-harness/th-cli scan https://example.com

# 扫描整个站点
pnpm --filter @test-harness/th-cli scan https://example.com --scope site

# 使用不同的 LLM 提供者
pnpm --filter @test-harness/th-cli scan https://example.com --provider openai --model gpt-4o
```

### 服务器 + Dashboard

```bash
# 启动服务器（API + Worker + 数据库）
node apps/server/th-server/dist/index.js
# → REST API: http://localhost:3000/api/v1
# → 健康检查: http://localhost:3000/api/v1/health

# 启动 React Dashboard（开发模式）
pnpm --filter @test-harness/th-dashboard dev
# → Dashboard: http://localhost:5173

# 通过 API 发起扫描
curl -X POST http://localhost:3000/api/v1/scans \
  -H "Content-Type: application/json" \
  -d '{"targetUrl":"https://example.com","scope":"site"}'

# 通过 WebSocket 观看实时进度
# ws://localhost:3000/ws
```

### Docker 部署

```bash
docker compose up -d            # 服务器在 :3000，Ollama 在 :11434
docker compose logs -f server
```

### 运行测试

```bash
npx vitest run                  # 7 个测试套件，84 个测试用例
```

完整 REST + WebSocket 端点参考请查看 [docs/API.md](docs/API.md)。

## 包清单

### 应用层

| 包名 | 路径 | 说明 |
|---|---|---|
| `@test-harness/th-server` | `apps/server/th-server` | 生产服务器（REST + WebSocket + Worker） |
| `@test-harness/th-dashboard` | `apps/web/th-dashboard` | React 18 单页应用（Vite + Tailwind + Zustand） |
| `@test-harness/th-cli` | `packages/cli/th-cli` | 命令行工具：`th scan <url>` |

### 框架核心

| 包名 | 路径 | 说明 |
|---|---|---|
| `@test-harness/th-protocol` | `packages/protocol/th-protocol` | 共享类型 + 事件定义（零运行时依赖） |
| `@test-harness/th-core` | `packages/core/th-core` | 插件框架：DI 容器、4 模式事件总线、效果系统 |
| `@test-harness/th-agent` | `packages/agent/th-agent` | Agent Loop + Session Log + Stream Assembler |

### LLM 适配器

| 包名 | 提供者 | 特性 |
|---|---|---|
| `@test-harness/th-llm` | 抽象接缝 | 路由、能力协商 |
| `@test-harness/th-llm-ollama` | [Ollama](https://ollama.ai) | 本地模型、流式输出、工具调用 |
| `@test-harness/th-llm-openai` | OpenAI | GPT-4o、流式输出、函数调用 |
| `@test-harness/th-llm-deepseek` | DeepSeek | V3/R1、OpenAI 兼容接口 |

### 检测插件（9 个检测器）

| 包名 | 类别 | 检测器 |
|---|---|---|
| `@test-harness/th-detection` | 框架 | Registry、Runner、Composer、Scoring |
| `@test-harness/th-detect-security` | 安全 | SecurityHeaders（6 个头部 + CSP 分析）、SSL/TLS |
| `@test-harness/th-detect-performance` | 性能 | PerformanceHeaders（缓存头、编码）、ResourceAnalyzer |
| `@test-harness/th-detect-seo` | SEO | MetaTags（标题/描述/OG/Twitter）、RobotsSitemap |
| `@test-harness/th-detect-a11y` | 无障碍 | ImageA11y、FormA11y、HeadingA11y |

### 基础设施

| 包名 | 路径 | 说明 |
|---|---|---|
| `@test-harness/th-tools` | `packages/tools/th-tools` | 工具框架 + 5 个内置工具（三阶段执行管线） |
| `@test-harness/th-crawl` | `packages/crawl/th-crawl` | HTTP 爬取 + DOM 提取 + robots.txt 解析 |
| `@test-harness/th-persistence` | `packages/persistence/th-persistence` | SQLite 仓库（扫描、结果、事件、报告） |
| `@test-harness/th-queue` | `packages/queue/th-queue` | 进程内任务队列（5 种任务类型，优先级，重试） |
| `@test-harness/th-worker` | `packages/worker/th-worker` | 任务处理器（Scan、Detection） |
| `@test-harness/th-report` | `packages/report/th-report` | 报告生成器（JSON / Markdown / HTML） |
| `@test-harness/th-api` | `packages/api/th-api` | REST API（9 个端点）+ WebSocket 网关 |

## 文档

| 文档 | 说明 |
|---|---|
| [贡献指南](CONTRIBUTING.md) | 环境搭建、编码规范、如何添加插件 |
| [API 参考](docs/API.md) | REST + WebSocket 端点完整文档与示例 |
| [插件开发指南](docs/PLUGIN-DEV.md) | 编写检测插件 / 工具 / LLM 适配器 |
| [DSH 架构分析](docs/DSH-ANALYSIS.md) | DeepSeek Harness 架构深度剖析 |
| [实现计划](docs/PROGRESS-REPORT.md) | 实现计划与进度报告 |

## 开发

```bash
pnpm install                 # 安装依赖
pnpm run build               # 构建全部 22 个包
pnpm run typecheck           # 类型检查所有包
npx vitest run               # 运行 84 个测试
pnpm run clean               # 清理所有 dist/ 目录
```

需要 **Node 20+** 和 **pnpm 10**（由 corepack 管理）。

## 项目状态

全部 4 个阶段完成 — **生产就绪**：

| 阶段 | 范围 | 包数 | 状态 |
|---|---|---|---|
| **Phase 1** | 基础架构 | 10 | ✅ 完成 |
| **Phase 2** | 核心增强 | 16 | ✅ 完成 |
| **Phase 3** | Web 平台 | 21 | ✅ 完成 |
| **Phase 4** | 生产就绪 | 22 | ✅ 完成 |

### 已完成

- ✅ 插件框架（DI 容器、4 模式事件总线、效果系统）
- ✅ Agent Loop（Session Log、Waterfall 事件、LLM 流式输出）
- ✅ 三阶段工具执行管线 + 超时控制
- ✅ 3 个 LLM 适配器（Ollama、OpenAI、DeepSeek）+ 故障转移
- ✅ 9 个检测插件，覆盖 4 大类别（22 个检测器）
- ✅ REST API（9 个端点）+ WebSocket 实时网关
- ✅ React Dashboard（6 个页面，实时扫描进度）
- ✅ SQLite 持久化（Repository 模式）
- ✅ 任务队列（优先级 + 重试）
- ✅ 报告生成（JSON / Markdown / HTML）
- ✅ 优雅停机、速率限制、Docker 部署
- ✅ GitHub Actions CI/CD（Node 20 + 22 矩阵）
- ✅ 84 个通过单元测试
- ✅ 完整文档（API、插件开发指南、贡献指南）

### 未来规划

-  PostgreSQL 持久化提供者（生产数据库）
- 📋 BullMQ + Redis（分布式任务队列）
- 📋 JWT 认证 + 多租户支持
- 📋 Kubernetes 部署 + Helm Charts
- 📋 定时扫描 + 扫描结果对比
- 📋 白标报告
- 📋 浏览器爬取（Puppeteer/Playwright）
-  反爬虫 / 代理支持

## 许可证

MIT
