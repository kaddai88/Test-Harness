/**
 * Test Workflow State Machine
 *
 * States: INIT → LOGIN → NAVIGATE → TEST → REPORT → DONE
 *
 * Based on FSM model-based testing theory (state transition testing).
 * Each transition has: guard (pre-condition) + invariant (post-condition).
 * Coverage is tracked via traversedTransitions.
 *
 * ═══════════════════════════════════════════════════════════════
 * State Transition Table (状态转换表)
 * ═══════════════════════════════════════════════════════════════
 *
 *  起始状态  │ 输入/事件                    │ Guard 条件                              │ 目标状态   │ 输出/动作
 * ─────────┼─────────────────────────────┼─────────────────────────────────────────┼────────────────────────────────
 *  INIT     │ browser_evaluate 发现登录表单 │ URL含login 或 HTML含password字段          │ LOGIN     │ 提示 Agent 填表登录
 *  INIT     │ browser_evaluate 发现仪表盘   │ 无登录表单且URL不含login                  │ NAVIGATE  │ 跳过登录，直接导航
 *  LOGIN    │ fill_form + evaluate 非登录页 │ loginSubmitted && 页面非登录              │ NAVIGATE  │ 进入导航阶段
 *  LOGIN    │ 登录失败/仍在登录页           │ 页面仍含登录表单                         │ LOGIN(自环)│ 提示 Agent 重试
 *  NAVIGATE │ navigate_to 到达目标模块      │ targetReached = true                    │ TEST      │ 开始功能测试
 *  NAVIGATE │ navigate_to 回到登录页        │ invariant 违反                          │ 告警       │ 不应发生，记录 violation
 *  TEST     │ 测试操作(click/fill/assert)   │ testExecuted                            │ TEST(自环) │ 继续测试
 *  TEST     │ stagnant ≥ 5 或覆盖率满足      │ testExecuted && (stagnant≥5 \|\| 关键转换已覆盖) │ REPORT │ 生成测试报告
 *  REPORT   │ report_finding 完成           │ always                                  │ DONE      │ 会话结束
 *
 * Invalid transitions (无效转换 — 触发 invariant 告警):
 *   - NAVIGATE 状态仍在登录页
 *   - TEST 状态但 loginConfirmed = false
 *   - REPORT 状态但 testExecuted = false
 *
 * Key transitions required for coverage (关键转换覆盖率):
 *   INIT→LOGIN, LOGIN→NAVIGATE, NAVIGATE→TEST, TEST→REPORT, REPORT→DONE
 *
 * Reference: 状态转换测试技术 — testwo.com/article/1843
 * ═══════════════════════════════════════════════════════════════
 */

export enum WorkflowState {
  INIT = 'init',
  LOGIN = 'login',
  NAVIGATE = 'navigate',
  TEST = 'test',
  REPORT = 'report',
  DONE = 'done',
}

// Transition keys for coverage tracking
export type TransitionKey =
  | 'INIT→LOGIN' | 'INIT→NAVIGATE'
  | 'LOGIN→NAVIGATE'
  | 'NAVIGATE→TEST'
  | 'TEST→REPORT'
  | 'REPORT→DONE';

export interface WorkflowTransition {
  from: WorkflowState;
  to: WorkflowState;
  key: TransitionKey;
  guard: (context: WorkflowContext) => boolean;
  invariant: (context: WorkflowContext) => { ok: boolean; reason?: string };
  message: string;
}

export interface WorkflowContext {
  loginSubmitted: boolean;
  loginConfirmed: boolean;
  targetReached: boolean;
  testExecuted: boolean;
  currentPageUrl: string;
  lastPageContent: string;
  stagnantTurns: number;
  totalTurns: number;
  maxTurns: number;
  /** Coverage: which transitions have fired */
  traversedTransitions: string[];
  /** Invariant violations detected */
  invariantViolations: string[];
}

// ─── State Invariants ───
// Each state defines what MUST be true when the agent is in that state.
// Violations are logged but don't block execution (non-fatal).

function invariantFor(state: WorkflowState): (ctx: WorkflowContext) => { ok: boolean; reason?: string } {
  switch (state) {
    case WorkflowState.INIT:
      return () => ({ ok: true }); // No constraints at start

    case WorkflowState.LOGIN:
      return (ctx) => {
        const url = ctx.currentPageUrl.toLowerCase();
        const content = ctx.lastPageContent.toLowerCase();
        // Either we're on a login page, or we have credentials to submit
        const onLoginPage = url.includes('login') || content.includes('type="password"');
        const hasCredentials = ctx.loginSubmitted;
        if (onLoginPage || hasCredentials) return { ok: true };
        return { ok: false, reason: `LOGIN state but not on login page (url=${ctx.currentPageUrl}) and no credentials submitted` };
      };

    case WorkflowState.NAVIGATE:
      return (ctx) => {
        // Should not be on login page
        const onLogin = ctx.currentPageUrl.toLowerCase().includes('login') &&
          ctx.lastPageContent.toLowerCase().includes('type="password"');
        if (onLogin) return { ok: false, reason: 'NAVIGATE state but still on login page' };
        return { ok: true };
      };

    case WorkflowState.TEST:
      return (ctx) => {
        // Must have reached target and be logged in
        if (!ctx.targetReached) return { ok: false, reason: 'TEST state but targetReached is false' };
        if (!ctx.loginConfirmed && ctx.lastPageContent.toLowerCase().includes('type="password"')) {
          return { ok: false, reason: 'TEST state but login not confirmed and on login page' };
        }
        return { ok: true };
      };

    case WorkflowState.REPORT:
      return (ctx) => {
        if (!ctx.testExecuted) return { ok: false, reason: 'REPORT state but no test steps executed' };
        return { ok: true };
      };

    case WorkflowState.DONE:
      return () => ({ ok: true });

    default:
      return () => ({ ok: true });
  }
}

// ─── Transitions with Guards and Invariants ───

export const WORKFLOW_TRANSITIONS: WorkflowTransition[] = [
  {
    from: WorkflowState.INIT,
    to: WorkflowState.LOGIN,
    key: 'INIT→LOGIN',
    guard: (ctx) => {
      const url = ctx.currentPageUrl.toLowerCase();
      const content = ctx.lastPageContent.toLowerCase();
      const urlHasLogin = url.includes('login') || url.includes('signin') || url.includes('auth');
      const hasLoginForm = content.includes('type="password"') || content.includes('placeholder="密码"');
      // Cookie login: URL suggests login but content shows dashboard
      if (urlHasLogin && !hasLoginForm) {
        if (content.includes('dashboard') || content.includes('项目') ||
            content.includes('我的') || content.includes('admin') || content.includes('地盘')) return false;
      }
      return urlHasLogin || hasLoginForm;
    },
    invariant: invariantFor(WorkflowState.LOGIN),
    message: 'Page shows login form — entering LOGIN state',
  },
  {
    from: WorkflowState.INIT,
    to: WorkflowState.NAVIGATE,
    key: 'INIT→NAVIGATE',
    guard: (ctx) => {
      const url = ctx.currentPageUrl.toLowerCase();
      const content = ctx.lastPageContent.toLowerCase();
      const hasLoginForm = content.includes('type="password"');
      const urlIsLogin = url.includes('login') || url.includes('signin');
      if (content && !hasLoginForm && !urlIsLogin) return true;
      if (!url && !content && ctx.totalTurns >= 1) return true;
      return false;
    },
    invariant: invariantFor(WorkflowState.NAVIGATE),
    message: 'Already logged in — skipping to NAVIGATE',
  },
  {
    from: WorkflowState.LOGIN,
    to: WorkflowState.NAVIGATE,
    key: 'LOGIN→NAVIGATE',
    guard: (ctx) => {
      if (ctx.loginConfirmed) return true;
      const url = ctx.currentPageUrl.toLowerCase();
      const content = ctx.lastPageContent.toLowerCase();
      const hasLoginForm = content.includes('type="password"') || content.includes('placeholder="密码"');
      const hasDashboard = content.includes('dashboard') || content.includes('项目') ||
        content.includes('我的') || content.includes('admin') || content.includes('地盘');
      if (!hasLoginForm && hasDashboard && ctx.totalTurns >= 2) return true;
      // If we're on a non-login URL with substantial content, assume logged in
      if (url && !url.includes('login') && !hasLoginForm && content.length > 100) return true;
      return false;
    },
    invariant: invariantFor(WorkflowState.NAVIGATE),
    message: 'Login confirmed — entering NAVIGATE state',
  },
  {
    from: WorkflowState.NAVIGATE,
    to: WorkflowState.TEST,
    key: 'NAVIGATE→TEST',
    guard: (ctx) => ctx.targetReached,
    invariant: invariantFor(WorkflowState.TEST),
    message: 'Target module reached — entering TEST state',
  },
  {
    from: WorkflowState.TEST,
    to: WorkflowState.REPORT,
    key: 'TEST→REPORT',
    guard: (ctx) => {
      if (!ctx.testExecuted) return false;
      if (ctx.stagnantTurns >= 5) return true;
      // Transition if key coverage is sufficient (visited LOGIN→NAVIGATE and NAVIGATE→TEST)
      const hasKeyTransitions = ctx.traversedTransitions.includes('LOGIN→NAVIGATE') &&
        ctx.traversedTransitions.includes('NAVIGATE→TEST');
      if (hasKeyTransitions && ctx.stagnantTurns >= 3) return true;
      if (ctx.maxTurns > 0 && ctx.totalTurns >= ctx.maxTurns - 3) return true;
      return false;
    },
    invariant: invariantFor(WorkflowState.REPORT),
    message: 'Test steps completed — entering REPORT state',
  },
  {
    from: WorkflowState.REPORT,
    to: WorkflowState.DONE,
    key: 'REPORT→DONE',
    guard: () => true,
    invariant: invariantFor(WorkflowState.DONE),
    message: 'Report generated — workflow complete',
  },
];

// ─── Allowed Tools ───
// Phase 2: Generalization tools (observe_page, find_element, extract_data)
// Phase 3: Exploration tools (explore_site, configure_site)
// are added to every state where the agent interacts with the page.

export function getAllowedTools(state: WorkflowState): string[] | null {
  switch (state) {
    case WorkflowState.INIT:
      return null; // All tools allowed during init (includes explore_site)
    case WorkflowState.LOGIN:
      return ['fill_form', 'click_element', 'browser_evaluate', 'take_screenshot', 'navigate_to',
              'observe_page', 'find_element', 'extract_data', 'explore_site', 'configure_site'];
    case WorkflowState.NAVIGATE:
      return ['navigate_to', 'browser_evaluate', 'take_screenshot', 'click_element',
              'observe_page', 'find_element', 'explore_site'];
    case WorkflowState.TEST:
      return ['navigate_to', 'click_element', 'fill_form', 'browser_evaluate', 'take_screenshot', 'assert_visible', 'assert_text', 'report_finding',
              'observe_page', 'find_element', 'extract_data', 'explore_site', 'configure_site'];
    case WorkflowState.REPORT:
      return ['report_finding', 'browser_evaluate', 'extract_data'];
    case WorkflowState.DONE:
      return [];
    default:
      return null;
  }
}

// ─── State Prompts ───

export function getStatePrompt(state: WorkflowState): string {
  switch (state) {
    case WorkflowState.INIT:
      return `## Current Phase: INIT
Use observe_page (preferred) or browser_evaluate to check the current page. Look for login form elements (password inputs, login buttons). If login form detected → LOGIN. If dashboard/already logged in → NAVIGATE.`;
    case WorkflowState.LOGIN:
      return `## Current Phase: LOGIN

**Check first:** Use observe_page to see what's on the page. If it shows dashboard (not login form) → already logged in → navigate_to target module.
**If login form visible:**
1. Use find_element to locate username field (hint: "用户名" or "username")
2. Use find_element to locate password field (hint: "密码" or "password")
3. Use find_element to locate submit button (hint: "登录" or "login")
4. Use the returned selectors with fill_form / click_element
5. Use observe_page to verify login succeeded
6. Once not on login page → navigate_to the target module`;
    case WorkflowState.NAVIGATE:
      return `## Current Phase: NAVIGATE

Navigate to the specific module the user wants to test.
- Look at the user's instructions to find the target module name
- Use navigate_to to go there, or click menu items to find it
- After arriving, use observe_page to understand the new page
- Once on the target module page, you will enter TEST phase
- Do NOT go back to login page`;
    case WorkflowState.TEST:
      return `## Current Phase: TEST

Execute the user's test instructions on the current module:
1. Use observe_page to understand the page structure first
2. Use find_element to locate target elements by semantic description
3. Interact with the page: click menus, buttons, open pages, fill forms
4. Use observe_page after each action to verify results
5. Check that expected functionality works correctly
6. Use report_finding for any bugs or issues
7. Be thorough — test multiple aspects of the module

Stay in this phase until you have thoroughly tested the module. Do NOT go to REPORT prematurely.`;
    case WorkflowState.REPORT:
      return `## Current Phase: REPORT

Summarize your testing:
1. Use report_finding to report each issue found (with severity, title, description, recommendation)
2. If no issues found, report that the module works correctly
3. After reporting, the session will end`;
    case WorkflowState.DONE:
      return '## Current Phase: DONE\nWorkflow complete.';
    default:
      return '';
  }
}

// ─── Context Update ───

export function updateWorkflowContext(
  context: WorkflowContext,
  toolName: string,
  toolArgs: Record<string, unknown>,
  success: boolean,
  resultData?: Record<string, unknown>
): WorkflowContext {
  const updated = { ...context };

  // Login tracking: fill_form on login form
  if (toolName === 'fill_form' && success) {
    const inputData = JSON.stringify(toolArgs.data ?? '').toLowerCase();
    const isLoginForm = inputData.includes('account') || inputData.includes('password') ||
      inputData.includes('用户') || inputData.includes('密码') ||
      inputData.includes('username') || inputData.includes('passwd') ||
      inputData.includes('pwd') || inputData.includes('admin');
    if (isLoginForm) {
      updated.loginSubmitted = true;
    }
  }

  // URL from navigate_to
  if (toolName === 'navigate_to' && success) {
    updated.currentPageUrl = String(toolArgs.url ?? '');
  }

  // URL and HTML from browser_evaluate
  if (toolName === 'browser_evaluate' && success && resultData) {
    const observedUrl = String(resultData.url ?? '').toLowerCase();
    if (observedUrl && observedUrl !== 'about:blank') {
      updated.currentPageUrl = observedUrl;
    }
    const html = String(resultData.html ?? '');
    if (html) {
      updated.lastPageContent = html;
    }
  }

  // Phase 2: observe_page — provides distilled element summary instead of raw HTML.
  // We store a summary as lastPageContent for guard checks.
  if (toolName === 'observe_page' && success && resultData) {
    const observedUrl = String(resultData.url ?? '').toLowerCase();
    if (observedUrl && observedUrl !== 'about:blank') {
      updated.currentPageUrl = observedUrl;
    }
    // Build a content summary from the distilled elements for guard matching
    const elements = (resultData.elements as Array<Record<string, unknown>>) ?? [];
    const elementSummary = elements.map(el =>
      `[${el.role}] ${el.text ?? ''} ${el.name ?? ''} ${el.ariaLabel ?? ''}`
    ).join(' ').toLowerCase();
    if (elementSummary) {
      updated.lastPageContent = elementSummary;
    }
  }

  // Phase 2: find_element — semantic element location success
  // Counts as page interaction (test execution) when it succeeds
  if (toolName === 'find_element' && success) {
    // find_element itself doesn't confirm test execution,
    // but it shows the agent is actively locating elements
  }

  // Login confirmation: Agent filled a form and is now on a non-login page.
  // Don't require loginSubmitted — it may not be set if field names don't match keywords.
  if (toolName === 'browser_evaluate' && success && !context.loginConfirmed && context.totalTurns >= 2) {
    const url = updated.currentPageUrl.toLowerCase();
    const content = updated.lastPageContent.toLowerCase();
    const stillOnLogin = url.includes('login') && content.includes('type="password"');
    if (!stillOnLogin && content && content.length > 100) {
      updated.loginConfirmed = true;
    }
  }

  // Phase 2: Login confirmation via observe_page
  if (toolName === 'observe_page' && success && !context.loginConfirmed && context.totalTurns >= 2) {
    const url = updated.currentPageUrl.toLowerCase();
    const content = updated.lastPageContent.toLowerCase();
    // If observe_page shows no password-related elements and we're not on a login URL
    const hasPasswordElement = content.includes('password') || content.includes('密码') || content.includes('passwd');
    const onLoginPage = url.includes('login') && hasPasswordElement;
    if (!onLoginPage && content && content.length > 50) {
      updated.loginConfirmed = true;
    }
  }

  // Target reached
  if (toolName === 'navigate_to' && success) {
    updated.targetReached = true;
  }

  // Test execution — Phase 2: includes generalization tools
  if (['click_element', 'fill_form', 'assert_visible', 'assert_text', 'find_element'].includes(toolName) && success) {
    updated.testExecuted = true;
  }

  // Stagnation
  if (!success) {
    updated.stagnantTurns = (context.stagnantTurns ?? 0) + 1;
  } else if (toolName === 'take_screenshot') {
    updated.stagnantTurns = (context.stagnantTurns ?? 0) + 1;
  } else {
    updated.stagnantTurns = 0;
  }

  updated.totalTurns = (context.totalTurns ?? 0) + 1;

  return updated;
}

// ─── Transition Execution ───
// Called by the agent loop when a transition fires.
// Records coverage and checks invariants.

export interface TransitionResult {
  fired: boolean;
  transitionKey?: TransitionKey;
  message?: string;
  invariantOk: boolean;
  invariantViolation?: string;
}

export function tryTransition(
  context: WorkflowContext,
  currentState: WorkflowState
): TransitionResult {
  for (const t of WORKFLOW_TRANSITIONS) {
    if (t.from !== currentState) continue;
    if (!t.guard(context)) continue;

    // Transition fires — record coverage
    const updatedTransitions = [...context.traversedTransitions];
    if (!updatedTransitions.includes(t.key)) {
      updatedTransitions.push(t.key);
    }

    // Check invariant for the target state
    const invariantResult = t.invariant(context);

    return {
      fired: true,
      transitionKey: t.key,
      message: t.message,
      invariantOk: invariantResult.ok,
      invariantViolation: invariantResult.ok ? undefined : invariantResult.reason,
    };
  }

  return { fired: false, invariantOk: true };
}

// ─── Initial Context ───

export function createInitialContext(maxTurns: number = 99): WorkflowContext {
  return {
    loginSubmitted: false,
    loginConfirmed: false,
    targetReached: false,
    testExecuted: false,
    currentPageUrl: '',
    lastPageContent: '',
    stagnantTurns: 0,
    totalTurns: 0,
    maxTurns,
    traversedTransitions: [],
    invariantViolations: [],
  };
}
