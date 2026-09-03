/**
 * Built-in tool: explore_site — discover site structure and patterns.
 *
 * Phase 3 of the generalization layer: this tool performs an initial
 * exploration of the target site to discover:
 * 1. Navigation structure (menus, links, sections)
 * 2. Authentication patterns (login forms, OAuth buttons)
 * 3. Form patterns (input fields, submit buttons)
 * 4. Site constraints (iframes, CAPTCHAs, slow loads)
 *
 * Unlike observe_page (which focuses on interactive elements on the
 * current page), explore_site analyzes the broader site structure
 * and returns patterns that help the agent plan testing.
 *
 * Usage:
 *   explore_site({}) → full site exploration
 *   explore_site({ focus: "navigation" }) → focus on navigation structure
 *   explore_site({ focus: "auth" }) → focus on authentication patterns
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import type { THContainer } from "@test-harness/th-core";
import { BrowserDriverDefinition, type BrowserDriver } from "@test-harness/th-browser";

const inputSchema = z.object({
  focus: z.enum(["full", "navigation", "auth", "forms"]).optional().describe(
    'What aspect of the site to explore. "full" explores everything (default). ' +
    '"navigation" focuses on menus and links. "auth" focuses on login patterns. ' +
    '"forms" focuses on form structures.'
  ),
  maxDepth: z.number().optional().describe(
    'Maximum link depth to explore (default: 1). Higher values explore more pages but take longer.'
  ),
});

export function createExploreSiteTool(container: THContainer): Tool {
  return {
    id: "explore_site",
    name: "Explore Site",
    description:
      "Discover the structure and patterns of the target site. Analyzes navigation menus, " +
      "authentication forms, page layouts, and site constraints. Use this BEFORE starting " +
      "testing to understand the site's structure and plan your approach. " +
      "Returns a structured summary of discovered patterns that helps with test planning.",
    category: "browser",
    inputSchema,
    outputSchema: z.any(),
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const { focus, maxDepth } = inputSchema.parse(input);
      const browser = container.get(BrowserDriverDefinition) as BrowserDriver;
      const start = Date.now();

      try {
        const exploration: Record<string, unknown> = {
          focus: focus ?? "full",
          timestamp: Date.now(),
        };

        // Get page info for context
        const pageInfo = await browser.getPageInfo();
        exploration.url = pageInfo.url;
        exploration.title = pageInfo.title;

        // Distill the page to get interactive elements
        const distilled = await browser.distillDom();
        exploration.interactiveElements = distilled.elementCount;
        exploration.structure = distilled.structure;

        // Explore based on focus
        const doFull = !focus || focus === "full";

        // Navigation structure
        if (doFull || focus === "navigation") {
          exploration.navigation = await exploreNavigation(browser, distilled);
        }

        // Authentication patterns
        if (doFull || focus === "auth") {
          exploration.auth = await exploreAuth(browser, distilled);
        }

        // Form patterns
        if (doFull || focus === "forms") {
          exploration.forms = await exploreForms(browser, distilled);
        }

        // Site constraints
        if (doFull) {
          exploration.constraints = await exploreConstraints(browser, distilled);
        }

        // Generate summary for LLM
        const summary = generateExplorationSummary(exploration);

        return {
          success: true,
          data: {
            summary,
            ...exploration,
          },
          duration: Date.now() - start,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          duration: Date.now() - start,
        };
      }
    },
  };
}

/**
 * Explore navigation structure: menus, links, sections.
 */
async function exploreNavigation(
  browser: BrowserDriver,
  distilled: Awaited<ReturnType<BrowserDriver["distillDom"]>>
): Promise<Record<string, unknown>> {
  const nav: Record<string, unknown> = {
    menus: [] as string[],
    sections: [] as string[],
    topLinks: [] as Array<{ text: string; href: string }>,
  };

  // Find navigation elements
  const navElements = distilled.elements.filter(el =>
    el.role === "link" || el.role === "menuitem" || el.role === "tab" ||
    el.tag === "nav" || el.tag === "menu"
  );

  // Extract menu structure
  const menuTexts = navElements
    .filter(el => el.text && el.text.length > 0 && el.text.length < 50)
    .map(el => el.text);
  nav.menus = [...new Set(menuTexts)].slice(0, 20);

  // Try to get links for top-level navigation
  try {
    const links = await browser.getLinks();
    nav.topLinks = links
      .filter(l => l.text && l.href && !l.href.startsWith("javascript:"))
      .slice(0, 30)
      .map(l => ({ text: l.text.slice(0, 50), href: l.href }));
  } catch {
    // Links not available
  }

  return nav;
}

/**
 * Explore authentication patterns: login forms, OAuth buttons.
 */
async function exploreAuth(
  browser: BrowserDriver,
  distilled: Awaited<ReturnType<BrowserDriver["distillDom"]>>
): Promise<Record<string, unknown>> {
  const auth: Record<string, unknown> = {
    hasLoginForm: false,
    usernameField: null as string | null,
    passwordField: null as string | null,
    submitButton: null as string | null,
    oauthButtons: [] as string[],
    hints: {} as Record<string, string>,
  };

  // Look for password fields (strong indicator of login form)
  const passwordFields = distilled.elements.filter(el =>
    el.type === "password" ||
    el.name.toLowerCase().includes("password") ||
    el.name.toLowerCase().includes("passwd") ||
    el.ariaLabel.toLowerCase().includes("password") ||
    el.ariaLabel.toLowerCase().includes("密码")
  );

  if (passwordFields.length > 0) {
    auth.hasLoginForm = true;
    auth.passwordField = passwordFields[0]!.selector;
    (auth.hints as Record<string, string>).passwordHint = passwordFields[0]!.ariaLabel || passwordFields[0]!.name || "密码";
  }

  // Look for username/email fields near password fields
  const usernameFields = distilled.elements.filter(el =>
    (el.type === "text" || el.type === "email") &&
    (el.name.toLowerCase().includes("user") ||
     el.name.toLowerCase().includes("email") ||
     el.name.toLowerCase().includes("account") ||
     el.name.toLowerCase().includes("login") ||
     el.ariaLabel.toLowerCase().includes("用户") ||
     el.ariaLabel.toLowerCase().includes("email") ||
     el.placeholder.toLowerCase().includes("用户") ||
     el.placeholder.toLowerCase().includes("email"))
  );

  if (usernameFields.length > 0) {
    auth.usernameField = usernameFields[0]!.selector;
    (auth.hints as Record<string, string>).usernameHint = usernameFields[0]!.ariaLabel || usernameFields[0]!.name || usernameFields[0]!.placeholder || "用户名";
  }

  // Look for submit buttons
  const submitButtons = distilled.elements.filter(el =>
    (el.role === "button" || el.tag === "button") &&
    (el.text.toLowerCase().includes("登录") ||
     el.text.toLowerCase().includes("login") ||
     el.text.toLowerCase().includes("signin") ||
     el.text.toLowerCase().includes("submit") ||
     el.ariaLabel.toLowerCase().includes("登录") ||
     el.ariaLabel.toLowerCase().includes("login"))
  );

  if (submitButtons.length > 0) {
    auth.submitButton = submitButtons[0]!.selector;
    (auth.hints as Record<string, string>).submitHint = submitButtons[0]!.text || submitButtons[0]!.ariaLabel || "登录";
  }

  // Look for OAuth buttons (Google, GitHub, etc.)
  const oauthButtons = distilled.elements.filter(el =>
    el.role === "button" &&
    (el.text.toLowerCase().includes("google") ||
     el.text.toLowerCase().includes("github") ||
     el.text.toLowerCase().includes("wechat") ||
     el.text.toLowerCase().includes("微信") ||
     el.text.toLowerCase().includes("qq") ||
     el.ariaLabel.toLowerCase().includes("oauth") ||
     el.ariaLabel.toLowerCase().includes("第三方"))
  );

  auth.oauthButtons = oauthButtons.map(el => el.text || el.ariaLabel).filter(Boolean);

  return auth;
}

/**
 * Explore form patterns: input fields, submit buttons.
 */
async function exploreForms(
  browser: BrowserDriver,
  distilled: Awaited<ReturnType<BrowserDriver["distillDom"]>>
): Promise<Record<string, unknown>> {
  const forms: Record<string, unknown> = {
    formCount: distilled.structure.formCount,
    forms: [] as Array<Record<string, unknown>>,
  };

  // Find all form-related elements
  const formElements = distilled.elements.filter(el =>
    el.role === "textbox" || el.role === "combobox" || el.role === "checkbox" ||
    el.role === "radio" || el.role === "spinbutton" ||
    el.tag === "input" || el.tag === "select" || el.tag === "textarea"
  );

  // Group by proximity (simple heuristic: elements within same form or section)
  const formGroups = new Map<string, typeof formElements>();
  for (const el of formElements) {
    // Use form id or name as group key, or "default" if none
    const key = el.name.split("[")[0] ?? "default";
    if (!formGroups.has(key)) {
      formGroups.set(key, []);
    }
    formGroups.get(key)!.push(el);
  }

  // Build form summaries
  for (const [key, elements] of formGroups) {
    if (elements.length === 0) continue;

    const form: Record<string, unknown> = {
      id: key,
      fieldCount: elements.length,
      fields: elements.slice(0, 20).map(el => ({
        name: el.name || el.ariaLabel || el.placeholder || "unknown",
        type: el.type || el.role,
        hint: el.ariaLabel || el.placeholder || el.name,
        selector: el.selector,
      })),
    };

    // Look for submit button in the form
    const submitBtn = distilled.elements.find(el =>
      el.role === "button" &&
      (el.text.toLowerCase().includes("提交") ||
       el.text.toLowerCase().includes("submit") ||
       el.text.toLowerCase().includes("保存") ||
       el.text.toLowerCase().includes("save"))
    );
    if (submitBtn) {
      form.submitButton = submitBtn.selector;
      form.submitHint = submitBtn.text || submitBtn.ariaLabel || "提交";
    }

    (forms.forms as Array<Record<string, unknown>>).push(form);
  }

  return forms;
}

/**
 * Explore site constraints: iframes, CAPTCHAs, etc.
 */
async function exploreConstraints(
  browser: BrowserDriver,
  distilled: Awaited<ReturnType<BrowserDriver["distillDom"]>>
): Promise<Record<string, unknown>> {
  const constraints: Record<string, unknown> = {
    hasIframes: distilled.structure.hasIframes,
    iframeCount: distilled.structure.iframeCount,
    hasTables: distilled.structure.hasTables,
    hasCaptcha: false,
    hasShadowDom: false,
    slowLoad: false,
  };

  // Check for CAPTCHA indicators
  const captchaElements = distilled.elements.filter(el =>
    el.text.toLowerCase().includes("captcha") ||
    el.text.toLowerCase().includes("验证码") ||
    el.ariaLabel.toLowerCase().includes("captcha") ||
    el.ariaLabel.toLowerCase().includes("验证码") ||
    el.name.toLowerCase().includes("captcha")
  );
  constraints.hasCaptcha = captchaElements.length > 0;

  // Check for shadow DOM (harder to detect, but we can check for custom elements)
  const customElements = distilled.elements.filter(el =>
    el.tag.includes("-") // Custom elements typically have hyphens
  );
  constraints.hasShadowDom = customElements.length > 5;

  return constraints;
}

/**
 * Generate a human-readable summary of the exploration results.
 */
function generateExplorationSummary(exploration: Record<string, unknown>): string {
  const lines: string[] = [];

  lines.push(`# Site Exploration Summary`);
  lines.push(``);
  lines.push(`**URL:** ${exploration.url}`);
  lines.push(`**Title:** ${exploration.title}`);
  lines.push(`**Interactive Elements:** ${exploration.interactiveElements}`);
  lines.push(``);

  // Navigation
  const nav = exploration.navigation as Record<string, unknown> | undefined;
  if (nav) {
    lines.push(`## Navigation`);
    const menus = nav.menus as string[] | undefined;
    if (menus && menus.length > 0) {
      lines.push(`- Menu items: ${menus.slice(0, 10).join(", ")}`);
    }
    const topLinks = nav.topLinks as Array<{ text: string }> | undefined;
    if (topLinks && topLinks.length > 0) {
      lines.push(`- Top links: ${topLinks.slice(0, 10).map(l => l.text).join(", ")}`);
    }
    lines.push(``);
  }

  // Auth
  const auth = exploration.auth as Record<string, unknown> | undefined;
  if (auth) {
    lines.push(`## Authentication`);
    lines.push(`- Login form: ${auth.hasLoginForm ? "Yes" : "No"}`);
    if (auth.hasLoginForm) {
      const hints = auth.hints as Record<string, string> | undefined;
      if (hints) {
        if (hints.usernameHint) lines.push(`- Username field hint: "${hints.usernameHint}"`);
        if (hints.passwordHint) lines.push(`- Password field hint: "${hints.passwordHint}"`);
        if (hints.submitHint) lines.push(`- Submit button hint: "${hints.submitHint}"`);
      }
    }
    const oauth = auth.oauthButtons as string[] | undefined;
    if (oauth && oauth.length > 0) {
      lines.push(`- OAuth options: ${oauth.join(", ")}`);
    }
    lines.push(``);
  }

  // Forms
  const forms = exploration.forms as Record<string, unknown> | undefined;
  if (forms) {
    lines.push(`## Forms`);
    lines.push(`- Total forms: ${forms.formCount}`);
    const formList = forms.forms as Array<Record<string, unknown>> | undefined;
    if (formList && formList.length > 0) {
      lines.push(`- Form details:`);
      for (const form of formList.slice(0, 5)) {
        lines.push(`  - ${form.id}: ${form.fieldCount} fields`);
      }
    }
    lines.push(``);
  }

  // Constraints
  const constraints = exploration.constraints as Record<string, unknown> | undefined;
  if (constraints) {
    lines.push(`## Constraints`);
    if (constraints.hasIframes) lines.push(`- Uses iframes (${constraints.iframeCount})`);
    if (constraints.hasCaptcha) lines.push(`- Has CAPTCHA`);
    if (constraints.hasShadowDom) lines.push(`- Uses Shadow DOM`);
    lines.push(``);
  }

  return lines.join("\n");
}
