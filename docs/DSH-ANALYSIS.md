# DeepSeek Harness (DSH) 深度架构分析报告

> 基于对 https://github.com/deepseek-ai/deepseek-harness 源码的完整分析
> 226 个包 | 7807 个文件 | Cordis 插件框架驱动

---

## 一、DSH 核心架构全景

### 1.1 设计哲学

DSH 的核心哲学是 **"Everything is a Plugin"**（一切皆插件），基于 [Cordis](https://github.com/cordiverse/cordis) 框架构建。

| 设计原则 | DSH 实现方式 | Test-Harness 借鉴 |
|---|---|---|
| **一切皆插件** | 模型适配器、工具注册表、会话日志、Agent Loop 本身都是 Cordis 插件 | 检测模块、LLM 提供者、爬虫、存储后端都应是插件 |
| **能力接缝 (Capability Seam)** | Service Definition → Provider → Consumer 三角色 | DetectionDefinition → DetectionProvider → AgentLoop |
| **注册即可逆效果** | `ctx.effect()` / `ctx.on()` 返回 disposer，卸载时逆序回收 | 我们的 th-core 需要加入此能力 |
| **会话日志是唯一真相** | append-only SessionEvent log，消息历史由 `deriveMessages()` 投影 | 需要引入 session log 概念 |
| **Waterfall 中间件** | 核心扩展点都是 waterfall 事件（around-middleware 模式） | 当前缺少 waterfall 机制 |

### 1.2 仓库结构

```
vendor/        8 个 vendored Cordis 包 (cordis, schemastery, loader, ...)
packages/      226 个 @deepseek-ai/dsh-* 工作区包
  core/          产品 API 脊柱
    agent/         Agent 接口 + 活跃注册表 (ctx.agents)
    agent-loop/    默认 Agent 驱动器 (ctx.agentLoop)  ← 核心！
    session/       Append-only 事件日志 (ctx.sessions)
    system-prompt/ 提示词组装 (ctx.systemPrompt)
    tools/         工具注册表 + 执行管线 (ctx.tools)  ← 1947 行！
    scope/         每个 Agent 的隔离注册域
  llm/           LLM 能力接缝
    llm/           适配器注册 + 流协议 (ctx.llm)  ← 947 行
    llm-deepseek/  DeepSeek 适配器 (fetch + SSE)
    llm-retry/     重试策略中间件
    token-meter/   Token 计量
  session/       持久化、投影、标题、遥测
  shell/         Bash 能力 (Service Def + local/pwsh 提供者)
  fs/            文件系统能力 + 策略
  web/           Web 能力 (搜索/获取提供者)
  subagent/      子智能体能力
  workflow/      工作流能力
  client/        40+ UI 模块包
  ...
apps/
  cli/           dsh CLI 入口
  web/           Web 应用
```

### 1.3 Profile + Bundle 组合模型

DSH 的启动是一个 **插件树组合** 过程：

```
Profile (如 "web", "headless")
  ├── Bundle 列表 (有序)
  │   ├── dsh-base (第一层：模型适配器、工具、持久化、沙箱)
  │   ├── dsh-web-app (浏览器应用)
  │   └── dsh-headless (一次性运行器)
  ├── cordis.patch.yml (Profile 级覆盖)
  ├── $DSH_HOME/cordis.patch.yml (机器级覆盖)
  └── --patch 叠加层 (CLI 参数)
```

每一层都可以替换任何配置行，实现 **零侵入式扩展**。

---

## 二、Agent Loop 深度剖析（核心！）

### 2.1 架构总览

```
AgentLoop (Cordis Service → ctx.agentLoop)
  ├── FactoryOwnership — 跟踪活跃 Agent + 启动任务
  ├── Config — { maxParallelToolCalls, agents[] }
  ├── create(id, options) → Agent
  └── resume(ownerCtx, options) → AgentHandle
        │
        ▼
ReactLoopAgent (实现 Agent 接口)  ← 515 行核心代码
  ├── Inbox — 两个队列：'next-turn' 和 'next-step'
  ├── Phase 状态机：idle → maintenance → running
  ├── Scope — 每个 Agent 隔离的注册域
  ├── Session — append-only 事件日志
  └── Turn/Step 驱动循环 (kick → turn → step)
```

### 2.2 Turn 生命周期（关键！）

```text
turn/start
  │  claim next-step input + 一个排队的消息
  │  组装 prompt sections + tool schemas
  │
  ├──→ agent/pre-step (waterfall)     → reject | enter(messages)
  │     reject 或 empty → 关闭 turn (无 step)
  │
  │  step/start
  │  将消息 append 为 user/message
  │  deriveMessages() 从日志投影模型历史
  │
  ├──→ agent/request (waterfall)      → LlmCallConfig
  ├──→ llm/stream (waterfall)         → StreamChunk 流
  │     assistant/chunk* → assistant/message
  │
  │  tool/call* →
  │    tools/pre-execute (waterfall) → 批准/拒绝/询问
  │    tools/execute (waterfall)     → 实际执行
  │    tools/post-execute (waterfall) → 接受/替换/阻止
  │    tool/result (emit)            → 观察结果
  │
  │  step/end
  │  工具需要更多请求？→ 下一个 step
  │
  ├──→ agent/turn-stopping (serial)   → 无 next()
  │
turn/end (reason: completed | aborted | error | max-tokens | blocked)
```

### 2.3 核心代码解析

**ReactLoopAgent 主循环：**

```typescript
// agent-loop/src/agent.ts (核心精简)
export class ReactLoopAgent implements Agent {
  private async kick(): Promise<void> {
    try { while (await this.turn()) {} }
    finally { /* 转回 idle，重放锁存的唤醒 */ }
  }

  private async turn(): Promise<boolean> {
    // 1. Append 'turn/start' 到 session log
    this.session.append('turn/start', { turn })
    
    // 2. 内部 step 循环
    while (true) {
      const decision = await this.preStep(target, { turn, step })
      if (decision.kind === 'reject') { turnEnds = { kind: 'blocked' }; return false }
      
      this.session.append('step/start', { turn, step })
      
      // 3. 将消息写入日志
      for (const message of decision.messages) {
        this.session.append('user/message', message)
      }
      
      // 4. 执行 step (model request + tool calls)
      const stepEnd = await this.step(assembly)
      
      this.session.append('step/end', { turn, step })
      
      // 5. 检查是否需要更多 step
      if (turnEnds && this.inbox.nextStep.length === 0) break
    }
    
    // 6. turn-stopping serial event
    await this.dispatch.serial('agent/turn-stopping', { turn, signal })
    
    // 7. Append 'turn/end'
    this.session.append('turn/end', { turn, reason: turnEnds })
    
    // 8. 返回 true 如果 inbox 还有消息
    return this.inbox.hasPending
  }

  private async step(assembly): Promise<StepEndReason | null> {
    // 1. 构建请求
    const { request, preparedCall } = await this.buildRequest(...)
    
    // 2. 流式调用 LLM
    const stream = preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request)
    for await (const chunk of stream) {
      this.session.append('assistant/chunk', { turn, step, chunk })
      assembler.push(chunk)
    }
    
    // 3. 组装完整的 assistant message
    this.session.append('assistant/message', { turn, step, message, usage })
    
    // 4. 处理 tool calls
    const toolCalls = message.content.filter(b => b.type === 'tool-call')
    if (toolCalls.length === 0) return { kind: 'completed' }
    
    const { concluded } = await executeToolCalls(ctx, turn, step, toolCalls, signal, acceptContext)
    return concluded ? { kind: 'completed' } : null
  }
}
```

### 2.4 工具调用调度器

DSH 的工具调用执行是一个精密的调度系统：

```typescript
// tool-calls.ts (核心精简)
export async function executeToolCalls(ctx, turn, step, toolCalls, signal, acceptContext) {
  // 1. 解析参数 (无效 JSON 保留为文本)
  const planned = toolCalls.map(block => ({
    block,
    exec: { callId: block.id, name: block.name, arguments: parseArguments(block.arguments) }
  }))

  // 2. 按执行模式分组：exclusive (barrier) vs parallel (rolling pool)
  while (next < planned.length) {
    const mode = ctx.tools.executionMode(first.exec).kind
    const group = mode === 'parallel' ? planned.slice(next) : [first]
    const outcome = await runGroup(ctx, turn, step, group, mode, signal, acceptContext)
    // ...
  }
}

// runGroup — bounded rolling pool
async function runGroup(ctx, turn, step, group, mode, signal, acceptContext) {
  // prepare() → dispatch() → finalize()/finish()
  // 结果按 MODEL 顺序提交 (非完成顺序)
  // Abort 时 drain 已启动的调用，为未启动的记录合成结果
}
```

**关键设计决策：**
- **Exclusive calls** 形成 barrier（前一个完成后才执行下一个）
- **Parallel calls** 使用 bounded rolling pool (`maxParallelToolCalls`)
- **结果按模型顺序提交**，不是完成顺序
- **Abort 优雅降级**：drain 已启动的，为未启动的记录合成错误结果

---

## 三、LLM 能力接缝

### 3.1 LlmRuntime (ctx.llm)

```typescript
export class LlmRuntime extends Service {
  // 注册
  registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle
  registerConfigurableProviders(entries): DirectoryRegistrationHandle
  
  // 核心 API
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>  // 唯一核心方法
  prepareCall(config, signal): Promise<PreparedLlmCall>          // 绑定到具体适配器
  resolveCallConfig(config, signal): Promise<LlmCallConfig>
  
  // 查询
  listProviders(): LlmProviderInfo[]
  listModels(provider): Promise<LlmModelInfo[]>
}
```

### 3.2 流协议 (StreamChunk)

```typescript
type StreamChunk =
  | { type: 'block-start'; index: number; blockType: ContentBlockType }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index; id: CallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason; replayState?: ReplayEnvelope }
```

### 3.3 Waterfall 拦截链

```
agent/request (waterfall) → 修改 LLM 调用配置
     ↓
llm/stream (waterfall) → 拦截/重试/路由流
     ↓
adapter.stream() → 实际网络调用
```

`llm-retry` 插件就是一个 waterfall listener，在 `llm/stream` 中拦截失败并重试。

---

## 四、工具系统（1947 行的 ToolRuntime）

### 4.1 执行管线

```
ToolExecutionInput
  → createExecution()     // 快照+冻结参数，分配 opaque token
  → prepare()             // tools/pre-execute waterfall + 审批 + 单调守卫
  → dispatch()            // tools/execute waterfall (around-dispatch) → tool.execute()
  → finalize()            // tools/post-execute waterfall + 内容最终化
  → finish()              // 物化 (快照+冻结) + tools/result emit
```

### 4.2 ToolDefinition 接口

```typescript
interface ToolDefinition extends ToolSchema {
  readonly output: ToolOutputDefinition
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  finalizeContent?(exec, result): ContentBlock[] | undefined
  timeoutMs?: number
  isConcurrencySafe?(args: unknown): boolean    // 并行执行 opt-in
  presentCall?(args: unknown): ToolCallView | undefined      // UI 状态
  presentResult?(args, result): ToolResultView | undefined   // UI 结果
}
```

### 4.3 作用域工具层

- 全局工具注册在根级别
- 作用域工具（通过 `agent.ctx`）遮蔽全局
- 限制在作用域链中交叉
- `view(scope)` 方法在一次层遍历中解析完整可见集

---

## 五、与我们当前实现的对比

### 5.1 已完成的部分 ✅

| 组件 | 我们的实现 | DSH 对标 | 完成度 |
|---|---|---|---|
| th-protocol | Message, ToolCall, LLMProvider, DetectionPlugin, Finding 等 | llm/types.ts, tools/types.ts | 80% |
| th-core | THPlugin, THContainer, EventBus, ServiceDefinition, Effect | Cordis (完整 DI 框架) | 60% |
| th-llm + th-llm-ollama | LLMProvider + Ollama 适配器 | LlmRuntime + DeepSeek adapter | 50% |
| th-crawl | CrawlService, HttpFetcher, BrowserFetcher, Extractors | (无对应 — DSH 用 tool-bash/web) | 90% |
| th-tools | ToolRegistry, 5 个内置工具 | ToolRuntime (1947 行) | 40% |
| th-detection | DetectionRegistry, DetectionRunner, DetectionComposer | (无独立 detection — 用 tool 系统) | 70% |
| th-detect-security | SecurityHeaders, SSL/TLS | (DSH 无内置检测) | 100% |
| th-agent | AgentLoop (Turn→Model→Tool→Result) | ReactLoopAgent (515 行) | 50% |
| th-cli | `th scan <url>` 命令 | `dsh --profile headless "task"` | 70% |

### 5.2 关键差距分析

| 差距领域 | DSH 做法 | 我们现状 | 影响 | 优先级 |
|---|---|---|---|---|
| **Session Log** | Append-only 事件日志，所有消息历史从日志投影 | 简单的 `history: Message[]` 数组 | 无法恢复、无法遥测、无法重放 | 🔴 高 |
| **Waterfall 事件** | 核心扩展点都是 waterfall (around-middleware) | 只有 emit 和 on | 无法拦截/修改 LLM 请求、工具执行 | 🔴 高 |
| **流式 LLM** | 原生 `AsyncIterable<StreamChunk>` | 只有 `complete()` 非流式 + `stream()` 接口但没使用 | 无法实时显示进度 | 🟡 中 |
| **工具执行管线** | prepare → dispatch → finalize → finish 四阶段 | 简单的 validate → execute | 无审批、无超时、无重试 | 🟡 中 |
| **并行工具调度** | Bounded rolling pool + exclusive barriers | 顺序执行所有工具调用 | 性能瓶颈 | 🟡 中 |
| **作用域注册** | per-agent Scope 隔离 | 全局注册表 | 多 Agent 场景受限 | 🟢 低 |
| **Profile/Bundle** | 声明式组合 + patch 覆盖 | 硬编码启动 | 扩展性差 | 🟢 低 |
| **Inbox 系统** | 双队列 (next-turn + next-step) | 无 | 无法中途注入消息 | 🟡 中 |
| **Phase 状态机** | idle → maintenance → running | 无状态机 | 无法处理维护任务 | 🟢 低 |

---

## 六、Phase 2 改进路线图

### 6.1 近期优先（2-4 周）

#### 任务 11：增强 Agent Loop — Session Log + Waterfall

**目标**: 将 Agent Loop 从简单数组升级为 append-only 日志驱动

```typescript
// 新增 session log
interface SessionEvent {
  seq: number
  type: string
  data: unknown
  timestamp: number
}

class SessionLog {
  private events: SessionEvent[] = []
  append(type: string, data: unknown): SessionEvent { ... }
  deriveMessages(): Message[] { ... }  // 从日志投影消息历史
}
```

**修改文件**: `th-agent/src/loop.ts`, 新增 `th-agent/src/session.ts`

#### 任务 12：实现 LLM 流式支持

**目标**: Agent Loop 使用流式 API，实时显示进度

```typescript
// 改为流式
const stream = context.llm.stream({ model, messages, tools })
for await (const chunk of stream) {
  eventBus.emit(AgentStreamEvent, { scanId, chunk })
  assembler.push(chunk)
}
```

**修改文件**: `th-agent/src/loop.ts`, `th-llm-ollama/src/provider.ts`

#### 任务 13：实现 Waterfall 事件系统

**目标**: 支持 around-middleware 模式的事件

```typescript
// EventBus 增强
interface EventBus {
  emit<T>(event, data): Promise<void>              // 观察者模式
  on<T>(event, handler): Disposable                // 观察者模式
  waterfall<T>(event, data, defaultFn): Promise<T> // 新增！中间件链
  serial<T>(event, data): Promise<T[]>             // 新增！串行管道
}
```

**修改文件**: `th-core/src/event.ts`

#### 任务 14：增强工具执行管线

**目标**: 实现 prepare → dispatch → finalize 三阶段

```typescript
// ToolRegistry.execute 增强
async execute(name, input, context): Promise<ToolResult> {
  const tool = this.tools.get(name)
  // 1. prepare: 验证 + 预处理
  const prepared = await this.prepare(tool, input, context)
  // 2. dispatch: 执行 + 超时控制
  const result = await this.dispatch(tool, prepared, context)
  // 3. finalize: 后处理 + 格式化
  return this.finalize(tool, result)
}
```

**修改文件**: `th-tools/src/registry.ts`

#### 任务 15：实现并行工具调度

**目标**: 支持并行工具调用 + 超时控制

```typescript
// Agent Loop 中
async executeToolCalls(toolCalls, context) {
  // 检查哪些工具是 concurrency-safe
  const parallel = toolCalls.filter(tc => tool.isConcurrencySafe?.(tc.arguments))
  const sequential = toolCalls.filter(tc => !tool.isConcurrencySafe?.(tc.arguments))
  
  // 并行执行 safe 工具
  const parallelResults = await Promise.all(
    parallel.map(tc => this.executeTool(tc, context))
  )
  // 顺序执行 unsafe 工具
  for (const tc of sequential) { ... }
}
```

**修改文件**: `th-agent/src/loop.ts`, `th-tools/src/registry.ts`

### 6.2 中期（4-6 周）

#### 任务 16-18：新增检测插件

- **th-detect-performance**: Core Web Vitals, 加载时间分析
- **th-detect-seo**: Meta 标签、Sitemap、robots.txt、结构化数据
- **th-detect-a11y**: axe-core 集成、ARIA、对比度、键盘导航

#### 任务 19：OpenAI + DeepSeek 适配器

- **th-llm-openai**: GPT-4o 适配器
- **th-llm-deepseek**: V3/R1 适配器

#### 任务 20：报告生成系统

- **th-report**: JSON + Markdown + HTML 报告

---

## 七、DSH 关键设计模式总结

### 7.1 我们必须借鉴的

1. **Append-only Session Log** — 所有模型可见内容必须可重放
2. **Waterfall 事件** — 核心扩展点的 around-middleware 模式
3. **流式 LLM** — 实时反馈是生产级系统的基本需求
4. **工具执行管线** — 多阶段执行 + 拦截点

### 7.2 我们可以简化的

1. **Cordis 完整框架** → 我们的简化版 THPlugin + THContainer 够用
2. **Profile/Bundle 系统** → 简单配置文件替代
3. **Typert 类型反射** → 直接用 TypeScript 类型
4. **双 Aggregate (Host/Client)** → 单一 TypeScript 项目

### 7.3 我们应该避免的

1. **过度拆分** — DSH 226 个包，我们要控制粒度
2. **Vendored 依赖** — 直接用 npm 包
3. **Pre-release 不稳定** — DSH 频繁 breaking change，我们需要稳定

---

## 八、总结

DSH 是一个 **极其精密** 的智能体框架，其核心创新在于：

1. **将 Agent Loop 本身做成可替换的插件** — 没有特权核心
2. **会话日志作为唯一真相** — 所有状态可重放、可审计
3. **Waterfall 事件作为扩展点** — 无需修改核心代码即可扩展行为
4. **工具系统的精密调度** — 并行/串行/超时/审批/重试全覆盖

我们的 Test-Harness 已经建立了良好的基础架构（Phase 1 完成），现在需要：
- **短期**：增强 Agent Loop（session log + waterfall + streaming）
- **中期**：扩展检测插件 + LLM 适配器 + 报告系统
- **长期**：Web 平台 + 分布式工作器 + 生产部署
