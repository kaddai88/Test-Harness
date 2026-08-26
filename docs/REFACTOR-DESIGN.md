# Test-Harness 2.0 — DSH 风格重构设计文档

> 从"固定插件扫描器"重构为"AI 驱动的智能体测试平台"
> 灵感来源：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

---

## 1. 核心问题：当前架构为什么不对？

### 当前架构（错误方向）

```
用户勾选检测类别（Security/SEO/Performance...）
    ↓
Agent Loop 按固定流程执行预定义插件
    ↓
LLM 只在最后生成报告文字
```

**问题**：
- LLM 不是大脑，只是报告生成器
- 测试策略是硬编码的，不智能
- 用户说"帮我测登录功能"，系统却去跑 SEO 检查
- 不符合 DSH 的"Everything is a plugin, AI decides"哲学

### 目标架构（DSH 风格）

```
用户用自然语言描述需求："帮我测一下这个禅道系统的登录和权限模块"
    ↓
LLM 理解意图 → 自主生成测试计划
    ↓
LLM 调用浏览器工具逐步执行（navigate/click/fill/assert）
    ↓
每一步实时流式输出到 Dashboard
    ↓
LLM 观察结果 → 动态调整后续测试
    ↓
最终输出测试报告 + 发现的问题
```

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        Test-Harness 2.0                          │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Dashboard (聊天式交互)                                     │ │
│  │  ┌──────────┐  ──────────────────────────────────────┐   │ │
│  │  │ 输入框    │  │  实时步骤流                            │   │ │
│  │  │"测登录"  │→ │  → AI: 导航到登录页... ✓              │   │ │
│  │  │          │  │  → AI: 填写用户名 admin... ✓          │   │ │
│  │  │          │  │  → AI: 点击登录按钮... ✓              │   │ │
│  │  │          │  │  → AI: 发现：密码错误时无提示 ⚠       │   │ │
│  │  └──────────┘  └──────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              ▼ WebSocket                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Agent Loop (LLM 自主规划)                                  │ │
│  │                                                             │ │
│  │  Turn 1: 理解需求 → 生成测试计划                             │ │
│  │  Turn 2: 执行步骤1 → 观察结果 → 决策下一步                   │ │
│  │  Turn 3: 执行步骤2 → 观察结果 → 决策下一步                   │ │
│  │  ...                                                        │ │
│  │  Turn N: 所有步骤完成 → 生成报告                             │ │
│  ────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              ▼ Tool Calls                         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Browser Tools (浏览器工具集)                               │ │
│  │  navigate_to | click | fill | assert | screenshot | observe │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              ▼ Puppeteer                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  真实浏览器 (Chrome)                                         │ │
│  └────────────────────────────────────────────────────────────┘ │
─────────────────────────────────────────────────────────────────┘
```

---

## 3. 关键类型定义

### 3.1 TestSession（替代原 Scan）

```typescript
interface TestSession {
  id: string;
  targetUrl: string;
  instructions: string;          // 用户的自然语言描述
  status: "idle" | "planning" | "executing" | "completed" | "failed";
  plan?: TestPlan;               // AI 生成的测试计划
  steps: TestStep[];             // 已执行的步骤
  findings: Finding[];           // 发现的问题
}
```

### 3.2 TestPlan（AI 生成）

```typescript
interface TestPlan {
  summary: string;               // AI 对需求的理解
  steps: PlannedStep[];          // 计划执行的步骤
}

interface PlannedStep {
  id: string;
  description: string;           // "导航到登录页面"
  action: BrowserAction;         // 具体浏览器操作
  expected?: string;             // 预期结果
}
```

### 3.3 BrowserAction（浏览器工具调用）

```typescript
type BrowserAction =
  | { type: "navigate"; url: string }
  | { type: "click"; selector: string }
  | { type: "fill"; selector: string; value: string }
  | { type: "submit"; selector?: string }
  | { type: "assert_visible"; selector: string }
  | { type: "assert_text"; selector: string; text: string }
  | { type: "screenshot"; fullPage?: boolean }
  | { type: "observe"; description?: string }  // AI 观察当前页面
  | { type: "execute_js"; script: string }
  | { type: "wait"; ms?: number; selector?: string }
  | { type: "go_back" }
  | { type: "reload" };
```

### 3.4 TestStep（执行中的步骤）

```typescript
interface TestStep {
  id: string;
  action: BrowserAction;
  status: "pending" | "executing" | "completed" | "failed";
  result?: ActionResult;
  observation?: string;          // AI 的观察（"页面成功跳转到仪表盘"）
  decision?: string;             // AI 的下一步决策
}
```

---

## 4. Agent Loop 重构

### 4.1 当前（错误）

```typescript
// 固定流程：爬取 → 检测 → 报告
const result = await agent.run({
  target: url,
  config: { detections: ["security", "seo"], strategy: "adaptive" }
});
```

### 4.2 目标（DSH 风格）

```typescript
// Turn 1: LLM 理解需求，生成测试计划
const plan = await llm.complete({
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: "帮我测一下登录功能，重点看表单验证和错误处理" }
  ]
});
// LLM 返回：{ plan: { steps: [navigate, fill, click, assert...] } }

// Turn 2-N: LLM 逐步执行，每步观察后决策下一步
for (const step of plan.steps) {
  const result = await executeBrowserAction(step.action);
  const observation = await llm.complete({
    messages: [
      ...history,
      { role: "assistant", content: `执行了 ${step.action.type}` },
      { role: "tool", content: JSON.stringify(result) }
    ]
  });
  // LLM 决定：继续下一步 / 调整计划 / 发现问题
}
```

### 4.3 System Prompt 设计

```
你是 TestHarness AI Agent，一个智能网站测试工程师。

你的工作方式：
1. 理解用户的测试需求
2. 生成测试计划（哪些页面、哪些功能、什么顺序）
3. 使用浏览器工具逐步执行测试
4. 每步执行后观察结果，动态调整后续计划
5. 记录发现的问题（bug、UI 问题、功能缺陷）

可用工具：
- navigate_to(url): 导航到页面
- click(selector): 点击元素
- fill(selector, value): 填写表单
- assert_visible(selector): 断言元素可见
- assert_text(selector, text): 断言文本内容
- screenshot(): 截图
- observe(): 观察当前页面状态

规则：
- 像真实用户一样操作，不要假设页面结构
- 每步执行后都要 observe 确认结果
- 发现异常时记录为 finding，但继续测试
- 最终输出：测试总结 + 问题列表 + 建议
```

---

## 5. Dashboard 重构

### 5.1 当前（错误）

```
[表单] 选择检测类别 → 点击开始 → 等待 → 查看报告
```

### 5.2 目标（聊天式）

```
┌──────────────────────────────────────────────────────────────┐
│  Test-Harness                                                │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 🤖 AI: 我理解了，我将测试禅道系统的登录功能。           │ │
│  │    测试计划：                                           │ │
│  │    1. 导航到登录页                                     │ │
│  │    2. 测试正常登录                                     │ │
│  │    3. 测试错误密码                                     │ │
│  │    4. 测试空字段提交                                   │ │
│  │    开始执行...                                         │ │
│  ────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ → 导航到 http://185.200.65.4:82/zentao/... ✓          │ │
│  │ → 填写用户名: admin ✓                                  │ │
│  │ → 填写密码: **** ✓                                     │ │
│  │ → 点击登录按钮 ✓                                       │ │
│  │ → 观察：页面跳转到 /zentao/my/ ✓                       │ │
│  │                                                        │ │
│  │ → 点击退出登录 ✓                                       │ │
│  │ → 填写错误密码: wrong123 ✓                             │ │
│  │ → 点击登录 ✓                                           │ │
│  │ → ⚠ 发现：密码错误时没有错误提示！                     │ │
│  │                                                        │ │
│  │ → 清空用户名，直接点击登录 ✓                           │ │
│  │ → ⚠ 发现：空字段提交没有验证！                         │ │
│  └──────────────────────────────────────────────────────── │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 输入测试需求...                              [发送]    │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 5.3 实时推送（WebSocket）

```typescript
// Server → Client
type WSEvent =
  | { type: "plan_created"; plan: TestPlan }
  | { type: "step_started"; step: TestStep }
  | { type: "action_executed"; result: ActionResult }
  | { type: "observation"; text: string }
  | { type: "finding"; finding: Finding }
  | { type: "session_completed"; summary: string };
```

---

## 6. 数据流

```
用户输入："帮我测登录功能"
    │
    ▼
Dashboard ─POST /api/v1/sessions──→ Server
    │                                    │
    │                                    ▼
    │                              Session Created
    │                                    │
    │                                    ▼
    │                              Agent Loop Start
    │                                    │
    │                    ┌───────────────┼───────────────┐
    │                    ▼               ▼               ▼
    │              LLM Planning    Browser Tool    WebSocket
    │              (生成计划)       (执行操作)      (推送进度)
    │                    │               │               │
    │                    └───────────────┼───────────────┘
    │                                    ▼
    │                              Session Completed
    │                                    │
    │───────────────────────────────────┘
    │
    ▼
Dashboard 显示完整测试报告
```

---

## 7. 与 DSH 的对齐点

| DSH 概念 | Test-Harness 2.0 实现 |
|---|---|
| **Everything is a Plugin** | 浏览器工具是插件，LLM 决定调用哪个 |
| **Capability Seam** | BrowserDriver 定义 → PuppeteerProvider 实现 → Agent 消费 |
| **Agent Loop** | LLM 自主规划 → 执行 → 观察 → 决策循环 |
| **Session Log** | 记录每一步 AI 决策和浏览器操作 |
| **Waterfall Events** | 插件可拦截/修改 AI 决策和工具调用 |
| **Streaming** | 每步执行实时推送到 Dashboard |

---

## 8. 实施计划

### Phase 1: 清理旧代码（当前）
- [x] 删除旧的检测插件包
- [ ] 清理 CLI/Server/Worker 中的旧引用
- [ ] 确保编译通过

### Phase 2: 浏览器工具集
- [ ] 创建 8 个浏览器工具（navigate/click/fill/assert 等）
- [ ] 工具注册到 ToolRegistry
- [ ] 每个工具返回 ActionResult

### Phase 3: Agent Loop 重构
- [ ] LLM 生成测试计划
- [ ] 逐步执行 + 观察 + 决策循环
- [ ] 发现问题记录为 Finding

### Phase 4: Dashboard 重构
- [ ] 聊天式输入界面
- [ ] 实时步骤流显示
- [ ] WebSocket 接收推送

### Phase 5: 集成测试
- [ ] 端到端测试：输入 → 计划 → 执行 → 输出
- [ ] 验证 LLM 自主决策能力

---

## 9. 关键决策

### Q: 还要保留旧的"检测类别"概念吗？
**A**: 不保留。AI 根据用户指令自主决定测什么。用户说"测安全"，AI 就测安全；说"测登录"，AI 就测登录。

### Q: 旧的检测插件代码完全删除吗？
**A**: 暂时删除。如果未来需要，可以作为"工具"重新实现（比如 `run_security_check` 工具），但不是固定流程。

### Q: LLM 需要特殊的 prompt 工程吗？
**A**: 是的。System Prompt 需要教会 LLM：
1. 如何生成合理的测试计划
2. 如何使用浏览器工具
3. 如何观察结果并决策
4. 如何记录问题

### Q: 实时推送用 WebSocket 还是 SSE？
**A**: WebSocket。DSH 用 WebSocket，且我们需要双向通信（用户可能中途干预）。

---

## 10. 预期效果

**之前**：
> 用户："测一下这个网站"
> 系统：执行 Security + SEO + Performance 检查 → 输出报告
> 问题：用户想测登录功能，系统却去检查 meta 标签

**之后**：
> 用户："帮我测一下登录功能，看看表单验证和错误处理怎么样"
> 系统：
> 1. 理解需求 → 生成登录测试计划
> 2. 导航到登录页 → 截图确认
> 3. 测试正常登录 → 成功
> 4. 测试错误密码 → 发现没有错误提示！
> 5. 测试空字段 → 发现没有验证！
> 6. 输出：2 个问题 + 建议
>
> 用户："再测一下注册功能"
> 系统：继续测试注册流程...

---

*文档版本：2026-08-25*
*状态：设计评审中*
