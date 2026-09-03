# Test-Harness 平台实现计划与进度报告

> 最后更新: 2026-09-03 | 全部 5 个 Phase 完成 | 18 个包 | 70 个测试

---

## 一、项目概览

Test-Harness 是一个 **AI 驱动的网站质量检测平台**，灵感来源于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Cordis 插件架构。

**核心设计理念**:
- **一切皆插件** — LLM 适配器、检测模块、工具、存储后端都通过类型化的 Service Definition 注册
- **能力接缝 (Capability Seam)** — Service Definition → Provider → Consumer 三角色模式
- **Append-only Session Log** — 所有模型可见内容写入日志，消息历史从日志投影
- **Waterfall 中间件** — 每个关键管线节点都是可拦截的 around-middleware

---

## 二、实现进度总览

| Phase | 范围 | 包数 | 状态 | 用时 |
|---|---|---|---|---|
| **Phase 1** | 基础架构 | 10 | ✅ 完成 | Day 1 |
| **Phase 2** | 核心增强 | 16 | ✅ 完成 | Day 1-2 |
| **Phase 3** | Web 平台 | 21 | ✅ 完成 | Day 2 |
| **Phase 4** | 生产就绪 | 22 | ✅ 完成 | Day 2 |
| **Phase 5** | 泛化层 | 18 | ✅ 完成 | Day 3-4 |

**最终指标**:
- 18 个包全部构建成功 (turbo build)
- 70 个单元测试通过 (6 个测试套件)
- 16 个内置工具（含 5 个泛化工具）
- 3 个 LLM 适配器 (Ollama/OpenAI/DeepSeek)
- 9 个 REST API 端点 + WebSocket
- React Dashboard (6 页面)
- Docker + CI/CD 就绪
- 泛化层：DOM 降采样 + SmartLocator + SiteProfile 自学习 + 跨 session 缓存

---

## 三、Phase 1: 基础架构 ✅

### 目标
搭建 monorepo 骨架，实现核心框架和第一个可工作的 CLI 扫描。

### 完成的任务

| # | 任务 | 包 | 描述 |
|---|---|---|---|
| 1 | 项目骨架 | 根配置 | pnpm workspace, Turborepo, tsconfig, vitest |
| 2 | 共享类型层 | th-protocol | Message, Tool, Detection, Event 等所有共享接口 |
| 3 | 插件框架 | th-core | THPlugin, THContainer (DI), EventBus, EffectStack, PluginLoader |
| 4 | LLM 适配层 | th-llm + th-llm-ollama | LLMProvider 接口 + Ollama REST API 适配器 |
| 5 | Web 爬取 | th-crawl | HTTP Fetch (undici), DOM 提取 (cheerio), robots.txt 解析 |
| 6 | 工具框架 | th-tools | ToolRegistry + 5 个内置工具 (crawl_page, extract_dom, http_request, list_links, run_detection) |
| 7 | 检测框架 | th-detection | DetectionRegistry, DetectionRunner, DetectionComposer, Scoring |
| 8 | 安全检测 | th-detect-security | SecurityHeadersDetector (6 headers), SSLTLSDetector |
| 9 | Agent Loop | th-agent | Turn → Model → Tool → Result 管线 |
| 10 | CLI 应用 | th-cli | `th scan <url>` 命令 + 彩色终端输出 |

### 里程碑
```bash
pnpm --filter @test-harness/th-cli scan https://example.com
# ✅ 成功运行安全检测并输出结果
```

---

## 四、Phase 2: 核心增强 ✅

### 目标
借鉴 DSH 架构，增强 Agent Loop 的核心能力。

### 完成的任务

| # | 任务 | 描述 |
|---|---|---|
| 11 | Session Log | Append-only 事件日志，`deriveMessages()` 投影消息历史 |
| 12 | Waterfall 事件 | 4 种分发模式 (emit/waterfall/serial/parallel)，5 个 Waterfall 事件定义 |
| 13 | LLM 流式 | StreamAssembler + Agent Loop 使用 `llm.stream()` + 实时终端输出 |
| 14 | 工具管线 | prepare → dispatch → finalize 三阶段 + 超时控制 + 大结果截断 |
| 15 | 并行调度 | `isConcurrencySafe()` 标记 + 并行/独占分类 |
| 16 | 性能检测 | PerformanceHeadersDetector, ResourceAnalyzer |
| 17 | SEO 检测 | MetaTagsDetector, RobotsSitemapDetector |
| 18 | 无障碍检测 | ImageAccessibilityDetector, FormAccessibilityDetector, HeadingAccessibilityDetector |
| 19 | LLM 适配器 | OpenAI (GPT-4o) + DeepSeek (V3/R1) |
| 20 | 报告系统 | ReportGenerator + JSON/Markdown/HTML 渲染器 |

### 关键架构改进

#### Session Log (借鉴 DSH)
```typescript
class SessionLog {
  append(type, data): SessionEvent      // 追加事件
  deriveMessages(systemPrompt?): Message[]  // 投影消息历史
  getSummary(): { turns, steps, toolCalls, duration }
}
// 关键不变量: "Model-visible ⟺ logged"
```

#### Waterfall 事件系统
```typescript
// 4 种分发模式
bus.emit(event, data)           // 观察者通知
bus.waterfall(event, initial)   // around-middleware 链
bus.serial(event, data)         // 串行管道
bus.parallel(event, data)       // 并发执行

// 5 个 Waterfall 拦截点
AgentPreStepEvent      // 修改/拒绝消息
AgentRequestEvent      // 修改 LLM 配置
AgentTurnStoppingEvent // 请求继续 Turn
ToolsPreExecuteEvent   // 批准/拒绝/修改输入
ToolsPostExecuteEvent  // 修改/替换结果
```

#### Agent Loop 执行流程
```
Turn Start → Step Start
  → Pre-step Waterfall (插件可修改/拒绝)
  → Derive messages from SessionLog
  → Request Waterfall (插件可修改配置)
  → LLM Stream → StreamAssembler
  → For each tool call:
      → Pre-execute Waterfall
      → Prepare → Dispatch (timeout) → Finalize
      → Post-execute Waterfall
  → Step End
→ Turn-stopping Serial
→ Turn End
```

### 构建修复
- ✅ undici v7 API 兼容 (`maxRedirections` → `fetch()` + `AbortController`)
- ✅ TypeScript strict mode 全部通过
- ✅ 16 个包构建成功

---

## 三、Phase 3: Web 平台 ✅

> 注：Phase 3 的原始目标（Web 平台）已在 Phase 2/4 中合并完成。此处保留原始记录。

### 原始目标
构建完整的 Web 服务层：持久化、任务队列、REST API、WebSocket。

### 完成的任务

| # | 任务 | 包 | 描述 |
|---|---|---|---|
| 21 | 数据持久化 | th-persistence | SQLite 数据库 + Repository 模式 (scans, results, events, reports) |
| 22 | 任务队列 | th-queue + th-worker | 内存队列 (5 种 Job, 优先级, 指数退避重试) + Worker 处理器 |
| 23 | REST API | th-api | 9 个端点 + WebSocket 网关 (零框架, Node http) |
| 25 | 服务器应用 | th-server | 完整应用组合 + docker-compose.yml + Dockerfile |

### REST API 端点

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/scans` | 创建扫描 + 入队 |
| `GET` | `/api/v1/scans` | 列出扫描 (分页, 过滤) |
| `GET` | `/api/v1/scans/:id` | 扫描详情 + 检测结果 + 事件 |
| `DELETE` | `/api/v1/scans/:id` | 删除扫描 |
| `POST` | `/api/v1/scans/:id/cancel` | 取消扫描 |
| `GET` | `/api/v1/scans/:id/report` | 生成/获取报告 (?format=json\|markdown\|html) |
| `GET` | `/api/v1/detections` | 列出检测插件 |
| `GET` | `/api/v1/health` | 健康检查 |
| `GET` | `/api/v1/status` | 系统状态 |

### WebSocket 协议
```
ws://host/ws
→ scan:progress     // 扫描进度 (phase, progress%, currentStep)
→ agent:event       // Agent 活动 (turn, toolCall, toolResult)
→ scan:completed    // 扫描完成 (status, overallScore, findingSummary)
```

### 21 个包构建成功

---

## 六、Phase 4: 生产就绪 ✅

### 目标
React Dashboard、测试、CI/CD、生产加固。

### 完成的任务

| # | 任务 | 描述 |
|---|---|---|
| 26 | React Dashboard | React 18 + Vite + Tailwind + Zustand + Recharts (6 页面 + 10 组件) |
| 27 | 单元测试 | 70 个测试用例 (6 个测试文件) |
| 28 | CI/CD + 文档 | GitHub Actions + API.md + PLUGIN-DEV.md + CONTRIBUTING.md |
| 29 | 生产加固 | 优雅停机 + LLM 故障转移 + 速率限制 |

### React Dashboard

**技术栈**: React 18 + Vite + TypeScript + Tailwind CSS (dark theme) + Zustand + Recharts + React Router v6

**页面**:
| Route | 页面 | 功能 |
|---|---|---|
| `/` | Dashboard | 统计卡片、最近扫描、分数分布图、活动时间线 |
| `/scans/new` | NewScan | URL 输入、范围选择、检测类别勾选、策略选择 |
| `/scans/:id` | ScanDetail | 进度条、分数仪表盘、实时检测进度、实时 Findings、Agent 活动日志 |
| `/history` | ScanHistory | 分页表格、状态过滤标签 |
| `/scans/:id/report` | ReportView | 格式选择、分数分析、Findings 表格、建议列表、导出 |
| `/settings` | Settings | LLM 配置、扫描默认值、爬取配置 |

**构建产物**: HTML (0.5KB) + CSS (20KB) + JS (582KB)

### 单元测试 (70 通过)

| 测试文件 | 用例数 | 覆盖范围 |
|---|---|---|
| `event.test.ts` | 12 | EventBus emit/on/once/waterfall/serial/parallel/dispose/clear |
| `container.test.ts` | 12 | DI register/get/has/getAll/createChild/dispose |
| `session.test.ts` | 12 | SessionLog append/deriveMessages/getEventsByType/getSummary |
| `assembler.test.ts` | 10 | StreamAssembler push/partialContent/finish/toolCalls |
| `registry.test.ts` | 12 | ToolRegistry register/prepare/dispatch/finalize |
| `in-memory-queue.test.ts` | 12 | Queue add/process/priority/retry/remove |

### 生产加固

- **优雅停机**: SIGTERM/SIGINT 处理 → 停止 API → 等待 Worker → 关闭 DB
- **LLM 故障转移**: FailoverLLMProvider 按顺序尝试多个提供者
- **速率限制**: RateLimiter 内存滑动窗口 (可配置 req/min)

### CI/CD

```yaml
# .github/workflows/ci.yml
Node 20 + 22 矩阵 → pnpm install → build → typecheck → test
```

---

## 七、Phase 5: 泛化层 ✅

### 目标
实现跨站点泛化能力——Agent 无需硬编码 CSS/XPath 选择器即可测试任意网站。

### 完成的任务

| # | 任务 | 描述 |
|---|---|---|
| 30 | DOM 降采样 | 将 50k+ 节点 DOM 精简为 200-500 个可交互元素，分配 ref 编号 (@e1, @e2...) |
| 31 | SmartLocator | 5 级自动降级定位：缓存 → 语义搜索 → DOM 降采样 → CSS 选择器 → XPath 文本 |
| 32 | SiteProfile | 站点画像系统：语义提示（"登录按钮"）而非硬编码选择器 |
| 33 | 泛化工具 × 3 | observe_page（发现元素）、find_element（语义定位）、extract_data（结构化提取） |
| 34 | 工作流集成 | observe→find→act 范式、SiteHints 注入、状态机更新 |
| 35 | 跨 session 缓存 | site-profile-store 文件持久化，一次学习多次复用 |
| 36 | 自学习 Enricher | 从 session 活动自动发现认证/表单/导航模式，丰富 SiteProfile |
| 37 | 探索与配置工具 | explore_site（站点结构发现）、configure_site（用户配置入口） |

### 泛化层架构

```
┌─────────────────────────────────────────────────────────────┐
│                    泛化层三层解耦架构                          │
├─────────────────────────────────────────────────────────────┤
│  意图层 (Agent)                                              │
│    observe_page → find_element → click/fill/assert           │
│    Agent 用语义描述意图，不关心底层 DOM 结构                    │
├─────────────────────────────────────────────────────────────┤
│  知识层 (SiteProfile)                                        │
│    站点画像：认证模式、表单模式、导航模式、站点约束              │
│    跨 session 持久化 → 自动学习 → 越来越准                    │
├─────────────────────────────────────────────────────────────┤
│  交互层 (SmartLocator + DOM Distillation)                     │
│    5 级降级：缓存 → 语义 → 降采样 → CSS → XPath               │
│    50k+ DOM 节点 → 200-500 个可交互元素                       │
└─────────────────────────────────────────────────────────────┘
```

### 新增文件

| 文件 | 行数 | 描述 |
|---|---|---|
| `site-profile.ts` | 146 | SiteProfile 类型定义 |
| `distill-dom.ts` | 201 | DOM 降采样脚本（注入浏览器执行） |
| `smart-locator.ts` | 394 | 5 级降级元素定位器 |
| `site-profile-store.ts` | 111 | 文件持久化存储（按 hostname） |
| `site-profile-enricher.ts` | 390 | 自学习引擎（session 后自动分析） |
| `find-element.ts` | 75 | find_element 工具 |
| `observe-page.ts` | 133 | observe_page 工具 |
| `extract-data.ts` | 126 | extract_data 工具 |
| `explore-site.ts` | 411 | explore_site 工具 |
| `configure-site.ts` | ~200 | configure_site 工具 |

### 18 个包构建成功

---

## 八、完整包清单 (18 个)

### 应用层 (3)
| 包 | 描述 |
|---|---|
| `@test-harness/th-server` | 生产服务器 (REST + WebSocket + Worker) |
| `@test-harness/th-dashboard` | React SPA (6 页面, 实时扫描进度) |
| `@test-harness/th-cli` | CLI (`th test <url>`) |

### 框架核心 (3)
| 包 | 描述 |
|---|---|
| `@test-harness/th-protocol` | 共享类型 + 事件定义 (零运行时依赖) |
| `@test-harness/th-core` | 插件框架: DI, 4 模式事件总线, 效果系统 |
| `@test-harness/th-agent` | Agent Loop + Session Log + Stream Assembler + 工作流状态机 |

### LLM 适配器 (4)
| 包 | 提供者 | 特性 |
|---|---|---|
| `@test-harness/th-llm` | 抽象接缝 | 路由, 能力协商 |
| `@test-harness/th-llm-ollama` | Ollama | 本地模型, 流式, 工具调用 |
| `@test-harness/th-llm-openai` | OpenAI | GPT-4o, 流式, function calling |
| `@test-harness/th-llm-deepseek` | DeepSeek | V3/R1, OpenAI 兼容 |

### 工具与浏览器 (2)
| 包 | 描述 |
|---|---|
| `@test-harness/th-tools` | 工具框架 + 16 个内置工具（浏览器/HTTP + 5 个泛化工具） |
| `@test-harness/th-browser` | 浏览器能力接缝 + Playwright MCP + 泛化层（DOM 降采样、SmartLocator、SiteProfile） |

### 基础设施 (6)
| 包 | 描述 |
|---|---|
| `@test-harness/th-persistence` | JSON 文件仓库 (scans, results, events, reports) |
| `@test-harness/th-queue` | 内存任务队列 (5 种 Job, 优先级, 重试) |
| `@test-harness/th-worker` | Job 处理器 (Test Session, Report) |
| `@test-harness/th-report` | 报告生成器 (JSON / Markdown / HTML) |
| `@test-harness/th-api` | REST API (9 端点) + WebSocket 网关 |
| `@test-harness/th-dashboard` | React 18 SPA (Vite + Tailwind + Zustand) |

---

## 九、未来路线图

### 短期
- [ ] PostgreSQL 持久化提供者
- [ ] BullMQ + Redis 分布式任务队列
- [ ] JWT 认证 + 多租户支持
- [ ] 测试意图 DSL / 自然语言测试用例解析

### 中期
- [ ] 自适应探索策略 (WebProber 模式)
- [ ] 定时测试 + 结果对比
- [ ] 白标报告
- [ ] 反爬虫 / 代理支持

### 长期
- [ ] 多 Agent 协作测试
- [ ] Kubernetes 部署 + Helm Charts
- [ ] 扫描历史趋势分析
- [ ] 企业级 RBAC 权限控制

---

## 十、快速启动

```bash
# 安装
git clone <repo-url> && cd Test-Harness
pnpm install

# CLI 测试
pnpm --filter @test-harness/th-cli test https://example.com --instructions "测试登录功能"

# 启动服务器
node apps/server/th-server/dist/index.js

# 启动 Dashboard
pnpm --filter @test-harness/th-dashboard dev

# 运行测试
npx vitest run

# Docker
docker compose up -d

# 构建
pnpm run build   # 18 packages
```

---

*报告更新时间: 2026-09-03 | 37/37 任务完成*
