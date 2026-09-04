/**
 * Action Verification Module — validates that browser actions had intended effects.
 *
 * After each action (click, type, fill, navigate), this module:
 * 1. Compares before/after snapshots to detect state changes
 * 2. Scans for error indicators in the new page state
 * 3. Classifies anomalies (no change, error appeared, unexpected navigation)
 * 4. Generates guidance for recovery when actions fail
 *
 * This is the "correctness guard" for LLM-driven testing:
 * the LLM decides what to do, but we verify it actually worked.
 */

// ─── Types ───

export type ActionOutcome =
  | 'success'        // Action had expected effect
  | 'no_change'      // Page didn't change (action may have missed)
  | 'error_appeared' // Error message or validation appeared
  | 'unexpected_nav' // Navigated away from expected page
  | 'dialog_blocked' // Dialog/popup is blocking interaction
  | 'timeout';       // Action timed out

export interface VerificationResult {
  outcome: ActionOutcome;
  confidence: number;  // 0-1, how confident we are the action succeeded
  details: string;     // Human-readable explanation
  suggestions: string[];  // Recovery suggestions
}

export interface SnapshotDiff {
  changed: boolean;
  addedElements: string[];
  removedElements: string[];
  modifiedElements: string[];
}

// ─── Error Detection Patterns ───

const ERROR_PATTERNS = [
  // English
  /error/i, /failed/i, /invalid/i, /required/i, /not found/i,
  /unauthorized/i, /forbidden/i, /timeout/i, /exception/i,
  // Chinese
  /错误/, /失败/, /无效/, /必填/, /未找到/, /未授权/, /超时/, /异常/,
  /请输入/, /不能为空/, /格式不正确/,
];

const DIALOG_PATTERNS = [
  /dialog/i, /alert/i, /modal/i, /popup/i, /确认/, /确定/, /取消/,
  /are you sure/i, /confirm/i, /warning/i,
];

const SUCCESS_PATTERNS = [
  /success/i, /完成/, /成功/, /已保存/, /saved/i, /created/i, /updated/i,
  /submitted/i, /已提交/,
];

// ─── Snapshot Comparison ───

/**
 * Extract meaningful elements from aria snapshot text for comparison.
 * Filters out noise (timestamps, dynamic counters) and focuses on interactive elements.
 */
function extractSnapshotElements(snapshot: string): Set<string> {
  const elements = new Set<string>();
  if (!snapshot) return elements;

  // Extract ref-based elements: [ref=e3] button "提交"
  const refPattern = /\[ref=(\w+)\]\s*(\w+)\s+"([^"]+)"/g;
  let match;
  while ((match = refPattern.exec(snapshot)) !== null) {
    const [, ref, role, label] = match;
    if (ref && role && label) {
      elements.add(`${role}:${label.trim()}`);
    }
  }

  // Extract text content markers (for non-ref elements)
  const lines = snapshot.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and pure structural markers
    if (!trimmed || trimmed.startsWith('-') || trimmed.length < 3) continue;
    // Keep meaningful text content
    if (trimmed.length > 3 && trimmed.length < 100) {
      elements.add(`text:${trimmed}`);
    }
  }

  return elements;
}

/**
 * Compare two aria snapshots and identify changes.
 */
export function diffSnapshots(before: string, after: string): SnapshotDiff {
  const beforeElements = extractSnapshotElements(before);
  const afterElements = extractSnapshotElements(after);

  const added: string[] = [];
  const removed: string[] = [];

  for (const el of afterElements) {
    if (!beforeElements.has(el)) added.push(el);
  }
  for (const el of beforeElements) {
    if (!afterElements.has(el)) removed.push(el);
  }

  const changed = added.length > 0 || removed.length > 0;

  return {
    changed,
    addedElements: added.slice(0, 20),  // Limit for readability
    removedElements: removed.slice(0, 20),
    modifiedElements: [],  // TODO: detect attribute changes
  };
}

// ─── Action Verification ───

/**
 * Verify that an action had the intended effect.
 *
 * @param toolName - The MCP tool that was called
 * @param toolArgs - Arguments passed to the tool
 * @param beforeSnapshot - Aria snapshot BEFORE the action
 * @param afterSnapshot - Aria snapshot AFTER the action
 * @param currentUrl - Current page URL after action
 * @param expectedUrl - URL we expected to be on (if applicable)
 */
export function verifyAction(
  toolName: string,
  toolArgs: Record<string, unknown>,
  beforeSnapshot: string,
  afterSnapshot: string,
  currentUrl: string,
  expectedUrl?: string,
): VerificationResult {
  // Skip verification for read-only tools
  const readOnlyTools = ['browser_snapshot', 'browser_console_messages',
    'browser_network_requests', 'browser_take_screenshot', 'browser_find'];
  if (readOnlyTools.includes(toolName)) {
    return { outcome: 'success', confidence: 1.0, details: 'Read-only tool', suggestions: [] };
  }

  const diff = diffSnapshots(beforeSnapshot, afterSnapshot);
  const afterLower = afterSnapshot.toLowerCase();

  // ── Check for dialogs blocking interaction ──
  for (const pattern of DIALOG_PATTERNS) {
    if (pattern.test(afterSnapshot)) {
      // Dialog detected — might be blocking
      const hasDialogElements = afterSnapshot.includes('dialog') ||
        afterSnapshot.includes('alert') ||
        afterSnapshot.includes('确认') ||
        afterSnapshot.includes('确定');
      if (hasDialogElements && !diff.changed) {
        return {
          outcome: 'dialog_blocked',
          confidence: 0.7,
          details: 'Dialog/modal detected but no other changes — dialog may be blocking interaction',
          suggestions: [
            'Use browser_handle_dialog to accept/dismiss the dialog',
            'Use browser_click on the "确认" or "取消" button',
            'Use browser_press_key Escape to dismiss',
          ],
        };
      }
    }
  }

  // ── Check for error indicators ──
  const errors: string[] = [];
  for (const pattern of ERROR_PATTERNS) {
    const matches = afterSnapshot.match(pattern);
    if (matches) errors.push(matches[0]);
  }

  if (errors.length > 0 && !beforeSnapshot.toLowerCase().includes(errors[0]?.toLowerCase() ?? '')) {
    // New error appeared after action
    return {
      outcome: 'error_appeared',
      confidence: 0.8,
      details: `Error indicators appeared after action: ${errors.slice(0, 3).join(', ')}`,
      suggestions: [
        'This may be a validation error — check what field caused it',
        'Take browser_snapshot to see the full error context',
        'Consider this a potential bug to report',
        'Try correcting the input and resubmitting',
      ],
    };
  }

  // ── Check for unexpected navigation ──
  if (toolName === 'browser_click' || toolName === 'browser_navigate') {
    if (expectedUrl && currentUrl && !currentUrl.includes(expectedUrl)) {
      return {
        outcome: 'unexpected_nav',
        confidence: 0.6,
        details: `Navigated to ${currentUrl} but expected ${expectedUrl}`,
        suggestions: [
          'Use browser_navigate_back to return',
          'Check if you clicked the wrong element',
          'Use browser_snapshot to understand current page',
        ],
      };
    }
  }

  // ── Check for no change ──
  if (!diff.changed && beforeSnapshot.length > 0) {
    // Action didn't change the page at all
    const isNavigation = toolName === 'browser_navigate';
    const isInteraction = ['browser_click', 'browser_type', 'browser_fill_form'].includes(toolName);

    if (isInteraction) {
      return {
        outcome: 'no_change',
        confidence: 0.5,
        details: 'Page did not change after interaction — action may have missed target',
        suggestions: [
          'Verify the ref is correct — take a fresh browser_snapshot',
          'The element might be disabled or not clickable',
          'Try browser_hover first to reveal hidden elements',
          'Check if there is an overlay blocking the element',
        ],
      };
    }

    if (isNavigation && currentUrl === String(toolArgs.url)) {
      return {
        outcome: 'no_change',
        confidence: 0.4,
        details: 'Navigation executed but page content unchanged',
        suggestions: [
          'Page may need time to load — use browser_wait_for',
          'Check if the URL is correct',
          'The page might require authentication',
        ],
      };
    }
  }

  // ── Check for success indicators ──
  const hasSuccessIndicator = SUCCESS_PATTERNS.some(p => p.test(afterSnapshot));
  if (hasSuccessIndicator || diff.changed) {
    return {
      outcome: 'success',
      confidence: hasSuccessIndicator ? 0.9 : 0.7,
      details: hasSuccessIndicator
        ? 'Success indicator detected in page'
        : `Page changed: +${diff.addedElements.length} -${diff.removedElements.length} elements`,
      suggestions: [],
    };
  }

  // Default: assume success if we can't determine
  return {
    outcome: 'success',
    confidence: 0.5,
    details: 'Action completed, no clear success/failure indicators',
    suggestions: ['Take browser_snapshot to verify current state'],
  };
}

// ─── Recovery Guidance ───

/**
 * Generate recovery guidance based on verification failure.
 */
export function getRecoveryGuidance(
  result: VerificationResult,
  consecutiveFailures: number,
): string {
  if (result.outcome === 'success') return '';

  const parts: string[] = [];

  switch (result.outcome) {
    case 'no_change':
      parts.push(`⚠️ ACTION VERIFICATION: Page did not change after action.`);
      if (consecutiveFailures >= 2) {
        parts.push(`This is attempt ${consecutiveFailures} — try a COMPLETELY DIFFERENT approach.`);
      }
      break;

    case 'error_appeared':
      parts.push(`⚠️ ACTION VERIFICATION: Error appeared after action.`);
      parts.push(`Details: ${result.details}`);
      if (consecutiveFailures >= 2) {
        parts.push(`Report this as a potential bug using report_finding.`);
      }
      break;

    case 'dialog_blocked':
      parts.push(`⚠️ ACTION VERIFICATION: Dialog/modal is blocking interaction.`);
      parts.push(`Use browser_handle_dialog or click the dialog button first.`);
      break;

    case 'unexpected_nav':
      parts.push(`⚠️ ACTION VERIFICATION: Navigated to unexpected page.`);
      parts.push(`Use browser_navigate_back or re-navigate to the correct page.`);
      break;
  }

  if (result.suggestions.length > 0) {
    parts.push(`Suggestions: ${result.suggestions.slice(0, 2).join('; ')}`);
  }

  return parts.join(' ');
}
