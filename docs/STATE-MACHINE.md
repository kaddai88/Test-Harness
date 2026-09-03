# Test-Harness 状态机 — 状态转换表

基于 FSM（有限状态机）模型测试理论，参考：[状态转换测试技术及其示例](https://www.testwo.com/article/1843)

## 状态定义

| 状态 | 含义 | 允许的工具 |
|------|------|-----------|
| `INIT` | 初始阶段 — 判断是否需要登录 | 全部 |
| `LOGIN` | 登录阶段 — 填写凭据并验证 | fill_form, click_element, browser_evaluate, take_screenshot, navigate_to |
| `NAVIGATE` | 导航阶段 — 前往目标测试模块 | navigate_to, browser_evaluate, take_screenshot, click_element |
| `TEST` | 测试阶段 — 执行功能测试 | navigate_to, click_element, fill_form, browser_evaluate, take_screenshot, assert_visible, assert_text, report_finding |
| `REPORT` | 报告阶段 — 总结发现 | report_finding, browser_evaluate |
| `DONE` | 结束 | 无 |

## 状态转换表

| # | 起始状态 | 输入/事件 | Guard 条件 | 目标状态 | 输出/动作 |
|---|---------|----------|-----------|---------|----------|
| 1 | INIT | browser_evaluate 返回页面信息 | URL含 login/signin/auth 或 HTML含 password 字段 | LOGIN | Agent 看到 LOGIN prompt，开始登录流程 |
| 2 | INIT | browser_evaluate 返回页面信息 | 无登录表单 且 URL不含login | NAVIGATE | 跳过登录（cookie 免登录），直接导航 |
| 3 | LOGIN | fill_form + browser_evaluate | loginSubmitted && 页面非登录页 | NAVIGATE | 登录成功，进入导航阶段 |
| 4 | LOGIN | browser_evaluate 仍在登录页 | 页面仍含 password 字段 | **LOGIN（自环）** | 登录失败，Agent 重试 |
| 5 | NAVIGATE | navigate_to 成功 | targetReached = true | TEST | 到达目标模块，开始测试 |
| 6 | TEST | 测试操作成功 | testExecuted && (stagnantTurns ≥ 5 \|\| 关键转换已覆盖) | REPORT | 测试完成，生成报告 |
| 7 | TEST | 测试操作（click/fill/assert） | 操作成功 | **TEST（自环）** | 继续测试 |
| 8 | REPORT | report_finding 调用 | always | DONE | 会话结束 |

## 无效转换（Invariant 告警）

| 起始状态 | 违规条件 | 说明 |
|---------|---------|------|
| NAVIGATE | currentPageUrl 含 login 且 HTML 含 password | 不应在导航阶段还停留在登录页 |
| TEST | loginConfirmed = false 且在登录页 | 测试阶段必须已登录 |
| TEST | targetReached = false | 测试阶段必须已到达目标模块 |
| REPORT | testExecuted = false | 报告阶段必须有测试执行记录 |

## 关键转换覆盖率

必须覆盖的转换（用于 TEST→REPORT 决策）：
- `INIT→LOGIN` 或 `INIT→NAVIGATE`（二者之一）
- `LOGIN→NAVIGATE`（cookie 免登录时跳过）
- `NAVIGATE→TEST`
- `TEST→REPORT`
- `REPORT→DONE`

覆盖情况在每个 turn 结束时通过 `traversedTransitions` 数组追踪，并在服务端日志中打印：
```
[Workflow] Coverage: [INIT→NAVIGATE, NAVIGATE→TEST, TEST→REPORT]
```

## 设计原则

1. **每个转换都有 guard（前置条件）和 invariant（后置验证）**
2. **自环转换是合法的** — LOGIN 自环表示登录重试，TEST 自环表示继续测试
3. **无效转换不阻断执行** — 记录 violation 告警但不崩溃
4. **覆盖率驱动结束** — TEST→REPORT 不仅看 stagnant，还看关键转换是否覆盖
