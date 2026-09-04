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

export interface TestPlanItem {
  description: string;
  completed: boolean;
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
  /** Test plan: LLM-generated tasks to complete before reporting */
  testPlan: TestPlanItem[];
  /** How many test actions (click/fill/assert) completed in TEST state */
  testActionCount: number;
  /** Distinct pages/views visited during testing */
  visitedPages: string[];
  /** Last action key for repetition detection (toolName:argHash) */
  lastActionKey: string;
  /** Consecutive repetitions of the same action */
  repeatedActionCount: number;
  /** Last aria snapshot (before current action) — for verification diff */
  lastSnapshot: string;
  /** Action verification: consecutive failures detected by verify module */
  verificationFailures: number;
  /** Action verification: last outcome */
  lastVerificationOutcome: string;
  /** Errors detected during testing (for reporting) */
  detectedErrors: Array<{ tool: string; error: string; turn: number }>;
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
        // Aria snapshot: password field shows as 'password' in the tree
        const onLoginPage = url.includes('login') || content.includes('password');
        const hasCredentials = ctx.loginSubmitted;
        if (onLoginPage || hasCredentials) return { ok: true };
        return { ok: false, reason: `LOGIN state but not on login page (url=${ctx.currentPageUrl}) and no credentials submitted` };
      };

    case WorkflowState.NAVIGATE:
      return (ctx) => {
        // Should not be on login page
        const onLogin = ctx.currentPageUrl.toLowerCase().includes('login') &&
          ctx.lastPageContent.toLowerCase().includes('password');
        if (onLogin) return { ok: false, reason: 'NAVIGATE state but still on login page' };
        return { ok: true };
      };

    case WorkflowState.TEST:
      return (ctx) => {
        // Must have reached target and be logged in
        if (!ctx.targetReached) return { ok: false, reason: 'TEST state but targetReached is false' };
        if (!ctx.loginConfirmed && ctx.lastPageContent.toLowerCase().includes('password')) {
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
      const hasLoginForm = content.includes('password') || content.includes('密码');
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
      const hasLoginForm = content.includes('password');
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
      const hasLoginForm = content.includes('password') || content.includes('密码');
      const hasDashboard = content.includes('dashboard') || content.includes('项目') ||
        content.includes('我的') || content.includes('admin') || content.includes('地盘') ||
        content.includes('product') || content.includes('program') || content.includes('project');
      // No login form + dashboard-like content → already logged in
      if (!hasLoginForm && hasDashboard && ctx.totalTurns >= 2) return true;
      // Non-login URL with substantial content → assume logged in
      if (url && !url.includes('login') && !hasLoginForm && content.length > 100) return true;
      // Safety valve: stuck in LOGIN too long without login form → force advance
      if (ctx.totalTurns >= 6 && !hasLoginForm) return true;
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
      // Must have test plan AND all items completed
      if (ctx.testPlan.length > 0) {
        const completed = ctx.testPlan.filter(t => t.completed).length;
        if (completed < ctx.testPlan.length) return false;
        return true;
      }
      // Fallback: no plan, require minimum activity
      if (ctx.testActionCount < 5) return false;
      if (ctx.stagnantTurns >= 5) return true;
      if (ctx.maxTurns > 0 && ctx.totalTurns >= ctx.maxTurns - 3) return true;
      return false;
    },
    invariant: invariantFor(WorkflowState.REPORT),
    message: 'Test plan completed — entering REPORT state',
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
// All Playwright MCP native tools + our custom tools
// MCP provides 24 tools: browser_snapshot, browser_click, browser_type, etc.

const ALL_MCP_TOOLS = [
  // Core interaction
  'browser_snapshot', 'browser_click', 'browser_type', 'browser_fill_form',
  'browser_select_option', 'browser_hover', 'browser_press_key',
  'browser_check', 'browser_uncheck', 'browser_drag', 'browser_drop',
  // Navigation
  'browser_navigate', 'browser_navigate_back',
  // Page info / diagnostics
  'browser_evaluate', 'browser_find', 'browser_wait_for',
  'browser_console_messages', 'browser_network_requests', 'browser_network_request',
  // Screenshot
  'browser_take_screenshot',
  // Tabs
  'browser_tabs',
  // Dialog
  'browser_handle_dialog',
  // File upload
  'browser_file_upload',
  // Viewport
  'browser_resize',
  // Code execution
  'browser_run_code_unsafe',
  // Close
  'browser_close',
];

export function getAllowedTools(state: WorkflowState): string[] | null {
  switch (state) {
    case WorkflowState.INIT:
      return null; // All tools allowed during init
    case WorkflowState.LOGIN:
      return [...ALL_MCP_TOOLS];
    case WorkflowState.NAVIGATE:
      return [...ALL_MCP_TOOLS];
    case WorkflowState.TEST:
      return [...ALL_MCP_TOOLS, 'report_finding'];
    case WorkflowState.REPORT:
      return ['report_finding', 'browser_evaluate', 'browser_snapshot'];
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
Use browser_snapshot to check the current page. Look at the aria tree for login form elements (textbox for username/password, button for login). If login form detected → LOGIN. If dashboard/already logged in → NAVIGATE.`;
    case WorkflowState.LOGIN:
      return `## Current Phase: LOGIN

**CRITICAL FIRST CHECK:** Use browser_snapshot to check if you're ACTUALLY on a login page.
- If the snapshot shows NO password/login fields → you are ALREADY LOGGED IN
- If already logged in → IMMEDIATELY browser_navigate to the target module
- If login form IS visible (textbox elements for username/password) → proceed below

**If login form visible:**
1. From browser_snapshot, find the username textbox ref (look for "用户名" or "username")
2. Find the password textbox ref (look for "密码" or "password")
3. Find the login button ref (look for "登录" or "login")
4. Use browser_fill_form to fill username and password fields
5. Use browser_click on the login button ref
6. The snapshot after click will show if login succeeded
7. Once not on login page → browser_navigate to the target module`;
    case WorkflowState.NAVIGATE:
      return `## Current Phase: NAVIGATE

Navigate to the specific module the user wants to test.
- Use browser_navigate to go to the target URL, or browser_click on menu item refs
- After arriving, browser_snapshot will automatically show the new page
- Once on the target module page, you will enter TEST phase
- Do NOT go back to login page`;
    case WorkflowState.TEST:
      return `## Current Phase: TEST

**STEP 1 — Create a test plan FIRST.** List 5-8 specific test actions.

**STEP 2 — Execute the plan.** Work through each item. After each action, review the auto-returned snapshot.

**STEP 3 — Report only when ALL plan items are done.**

CRITICAL RULES:
- Use browser_snapshot to understand the page first, then use refs to interact
- When you see a FORM page, use browser_fill_form BEFORE browser_click on submit
- NEVER click submit/save on an empty form
- Use browser_click with refs from the snapshot for all interactions
- After each action, review the returned snapshot to verify results
- Use browser_handle_dialog for any modal dialogs
- Use report_finding for any bugs found

General guidance:
1. browser_snapshot → understand page structure
2. browser_click refs → navigate menus, open pages
3. browser_fill_form / browser_type → fill forms
4. Review auto-snapshots after each action
5. Handle dialogs immediately`;
    case WorkflowState.REPORT:
      return `## Current Phase: REPORT

Summarize your testing:
1. Use report_finding for each issue found
2. If no issues, report that the module works correctly
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
  resultData?: Record<string, unknown>,
  currentState?: WorkflowState
): WorkflowContext {
  const updated = { ...context };

  // ── MCP native tool support ──
  // MCP tool results come as { text: string, images?: [...] } from the adapter.
  // The text contains the aria snapshot or JS evaluation result.

  // URL tracking: browser_navigate
  if (toolName === 'browser_navigate' && success) {
    updated.currentPageUrl = String(toolArgs.url ?? '');
  }

  // browser_snapshot: aria tree text → update lastPageContent for guard checks
  if (toolName === 'browser_snapshot' && success && resultData) {
    const text = String(resultData.text ?? '');
    if (text) {
      // Save previous snapshot for verification diff, then update
      updated.lastSnapshot = updated.lastPageContent;
      updated.lastPageContent = text.toLowerCase();
    }
    // Target reached: snapshot has substantial content
    if (text.length > 200 && currentState === WorkflowState.NAVIGATE) {
      updated.targetReached = true;
    }
  }

  // Login tracking: browser_fill_form on login form
  if (toolName === 'browser_fill_form' && success) {
    const inputData = JSON.stringify(toolArgs).toLowerCase();
    const isLoginForm = inputData.includes('password') ||
      inputData.includes('用户') || inputData.includes('密码') ||
      inputData.includes('username') || inputData.includes('passwd') ||
      inputData.includes('pwd') || inputData.includes('account');
    if (isLoginForm) {
      updated.loginSubmitted = true;
    }
  }

  // Login tracking: browser_type on login field
  if (toolName === 'browser_type' && success) {
    const element = String(toolArgs.element ?? '').toLowerCase();
    if (element.includes('password') || element.includes('用户') ||
        element.includes('密码') || element.includes('username')) {
      updated.loginSubmitted = true;
    }
  }

  // browser_evaluate: JS result text
  if (toolName === 'browser_evaluate' && success && resultData) {
    const text = String(resultData.text ?? '');
    if (text) {
      updated.lastPageContent = text.toLowerCase();
    }
  }

  // Login confirmation: after snapshot shows non-login page
  if (toolName === 'browser_snapshot' && success && !context.loginConfirmed && context.totalTurns >= 2) {
    const url = updated.currentPageUrl.toLowerCase();
    const content = updated.lastPageContent.toLowerCase();
    const hasPassword = content.includes('password') || content.includes('密码') || content.includes('passwd');
    const onLoginPage = url.includes('login') && hasPassword;
    if (!onLoginPage && content && content.length > 50) {
      updated.loginConfirmed = true;
    }
  }

  // Login confirmation: after evaluate shows non-login page
  if (toolName === 'browser_evaluate' && success && !context.loginConfirmed && context.totalTurns >= 2) {
    const url = updated.currentPageUrl.toLowerCase();
    const content = updated.lastPageContent.toLowerCase();
    const stillOnLogin = url.includes('login') && content.includes('password');
    if (!stillOnLogin && content && content.length > 100) {
      updated.loginConfirmed = true;
    }
  }

  // Test execution: MCP interaction tools
  const mcpActionTools = [
    'browser_click', 'browser_fill_form', 'browser_type',
    'browser_select_option', 'browser_check', 'browser_uncheck',
    'browser_hover', 'browser_press_key',
  ];
  if (mcpActionTools.includes(toolName) && success) {
    updated.testExecuted = true;
    updated.testActionCount = (context.testActionCount ?? 0) + 1;
  }

  // Track visited pages
  if (toolName === 'browser_navigate' && success) {
    const url = String(toolArgs.url ?? '');
    if (url && !updated.visitedPages.includes(url)) {
      updated.visitedPages = [...(context.visitedPages ?? []), url];
    }
  }

  // Stagnation
  if (!success) {
    updated.stagnantTurns = (context.stagnantTurns ?? 0) + 1;
  } else if (toolName === 'browser_take_screenshot' || toolName === 'browser_snapshot') {
    // Read-only tools don't count as progress for stagnation
    updated.stagnantTurns = (context.stagnantTurns ?? 0) + 1;
  } else {
    updated.stagnantTurns = 0;
  }

  // Repetition detection
  const actionKey = `${toolName}:${JSON.stringify(toolArgs)}`;
  if (actionKey === context.lastActionKey && success) {
    updated.repeatedActionCount = (context.repeatedActionCount ?? 0) + 1;
    if (updated.repeatedActionCount >= 3) {
      updated.stagnantTurns = (context.stagnantTurns ?? 0) + 1;
    }
  } else {
    updated.repeatedActionCount = 0;
  }
  updated.lastActionKey = actionKey;

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
    testPlan: [],
    testActionCount: 0,
    visitedPages: [],
    lastActionKey: '',
    repeatedActionCount: 0,
    lastSnapshot: '',
    verificationFailures: 0,
    lastVerificationOutcome: '',
    detectedErrors: [],
  };
}
