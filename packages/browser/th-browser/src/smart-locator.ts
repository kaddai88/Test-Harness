/**
 * SmartLocator — multi-strategy element location with self-healing.
 *
 * Solves the generalization problem: instead of relying on a single CSS
 * selector (which breaks when the site changes), SmartLocator tries multiple
 * strategies in order of reliability:
 *
 *   Level 1: Cached selector (self-healing — fastest if still valid)
 *   Level 2: Semantic text search (browser_find / findInPage)
 *   Level 3: DOM distillation match (role + text + aria-label)
 *   Level 4: Direct CSS selector (if provided by caller)
 *   Level 5: XPath fallback via evaluate
 *
 * When a strategy succeeds, the result is cached in the SiteProfile for
 * next time. When a cached selector fails, we automatically fall through
 * to slower strategies — this is the "self-healing" behavior.
 *
 * Inspired by:
 * - Stagehand observe() → act() pattern
 * - QA Wolf 6-type self-healing
 * - VON Similo LLM element localization (arXiv 2310.02046)
 */
import type { BrowserDriver, DistilledPage, DistilledElement, FindElementResult } from "./types.js";
import type { SiteProfile, CachedElement } from "./site-profile.js";
import { DISTILL_SCRIPT } from "./distill-dom.js";

/** Options for SmartLocator */
export interface SmartLocatorOptions {
  /** Timeout for element visibility checks (default: 5000) */
  timeout?: number;
  /** Whether to update the cache on success (default: true) */
  updateCache?: boolean;
  /** Minimum confidence threshold (default: 0.5) */
  minConfidence?: number;
}

/**
 * SmartLocator — the core generalization engine.
 *
 * Usage:
 *   const locator = new SmartLocator(browser, siteProfile);
 *   const result = await locator.findElement("登录按钮");
 *   await browser.click(result.selector);
 */
export class SmartLocator {
  private browser: BrowserDriver;
  private profile: SiteProfile | null;
  private distilledCache: DistilledPage | null = null;
  private distilledCacheTime = 0;
  /** How long the distilled DOM stays valid (ms) */
  private static readonly DISTILL_TTL = 10_000;

  constructor(browser: BrowserDriver, profile?: SiteProfile | null) {
    this.browser = browser;
    this.profile = profile ?? null;
  }

  /** Update the site profile (e.g., after loading from disk) */
  setProfile(profile: SiteProfile | null): void {
    this.profile = profile;
    this.distilledCache = null;
  }

  /**
   * Get the current element cache for persistence.
   * Returns a copy of the cache array.
   */
  getCache(): CachedElement[] {
    return this.profile ? [...this.profile.elementCache] : [];
  }

  /**
   * Load a previously saved element cache.
   * Creates a minimal profile if none exists.
   */
  setCache(cache: CachedElement[]): void {
    if (!this.profile) {
      this.profile = {
        name: '',
        baseUrl: '',
        forms: [],
        navigations: [],
        constraints: {},
        elementCache: [...cache],
        updatedAt: Date.now(),
      };
    } else {
      this.profile.elementCache = [...cache];
      this.profile.updatedAt = Date.now();
    }
  }

  /**
   * Find an element using multi-strategy fallback.
   *
   * @param hint - Semantic description of what to find (e.g., "登录按钮", "search input")
   * @param selector - Optional CSS selector as a hint (Level 4 fallback)
   * @param options - Additional options
   */
  async findElement(
    hint: string,
    selector?: string,
    options?: SmartLocatorOptions
  ): Promise<FindElementResult> {
    const timeout = options?.timeout ?? 5000;
    const updateCache = options?.updateCache ?? true;
    const minConfidence = options?.minConfidence ?? 0.5;

    // Level 1: Try cached selector (self-healing)
    const cached = this.findInCache(hint);
    if (cached) {
      const valid = await this.verifySelector(cached.selector, timeout);
      if (valid) {
        // Update hit count
        cached.hitCount++;
        cached.lastVerified = Date.now();
        return {
          selector: cached.selector,
          xpath: cached.xpath,
          strategy: "cache",
          confidence: 0.95,
          hint,
        };
      }
      // Cache miss — selector changed, fall through
    }

    // Level 2: Semantic text search via findInPage
    const semanticResult = await this.findBySemantic(hint);
    if (semanticResult && semanticResult.confidence >= minConfidence) {
      if (updateCache) this.updateCacheEntry(hint, semanticResult);
      return semanticResult;
    }

    // Level 3: DOM distillation match
    const distillResult = await this.findByDistillation(hint);
    if (distillResult && distillResult.confidence >= minConfidence) {
      if (updateCache) this.updateCacheEntry(hint, distillResult);
      return distillResult;
    }

    // Level 4: Direct CSS selector (if provided)
    if (selector) {
      const valid = await this.verifySelector(selector, timeout);
      if (valid) {
        const result: FindElementResult = {
          selector,
          strategy: "css",
          confidence: 0.7,
          hint,
        };
        if (updateCache) this.updateCacheEntry(hint, result);
        return result;
      }
    }

    // Level 5: XPath text search fallback
    const xpathResult = await this.findByXPathText(hint);
    if (xpathResult) {
      if (updateCache) this.updateCacheEntry(hint, xpathResult);
      return xpathResult;
    }

    throw new Error(
      `SmartLocator: cannot find element "${hint}". ` +
      `Tried: cache, semantic search, DOM distillation, CSS selector, XPath text search.`
    );
  }

  /**
   * Invalidate the distilled DOM cache, forcing a fresh distillation
   * on the next findByDistillation call.
   */
  invalidateDistilledCache(): void {
    this.distilledCache = null;
  }

  // ─── Strategy implementations ───

  /** Find a cached selector for the given hint */
  private findInCache(hint: string): CachedElement | null {
    if (!this.profile) return null;
    const normalizedHint = hint.toLowerCase().trim();
    // Exact match first
    const exact = this.profile.elementCache.find(
      (c) => c.hint.toLowerCase().trim() === normalizedHint
    );
    if (exact) return exact;
    // Partial match
    return this.profile.elementCache.find(
      (c) =>
        normalizedHint.includes(c.hint.toLowerCase().trim()) ||
        c.hint.toLowerCase().trim().includes(normalizedHint)
    ) ?? null;
  }

  /** Semantic text search using browser_find / findInPage */
  private async findBySemantic(hint: string): Promise<FindElementResult | null> {
    try {
      const result = await this.browser.findInPage({ text: hint });
      if (result && result !== "Not found" && !result.includes("Not found")) {
        // findInPage returns context around the match, not a selector.
        // We need to find the interactive element near this text.
        // Use distillation to locate the element.
        return await this.findByDistillation(hint);
      }
    } catch {
      // findInPage not available or failed
    }
    return null;
  }

  /** DOM distillation — find element by matching role/text/label */
  private async findByDistillation(hint: string): Promise<FindElementResult | null> {
    try {
      const distilled = await this.getDistilledPage();
      if (!distilled) return null;

      const normalizedHint = hint.toLowerCase().trim();
      let bestMatch: DistilledElement | null = null;
      let bestScore = 0;

      for (const el of distilled.elements) {
        const score = this.scoreElementMatch(el, normalizedHint);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = el;
        }
      }

      if (bestMatch && bestScore >= 0.5) {
        return {
          selector: bestMatch.selector,
          xpath: bestMatch.xpath,
          strategy: "distill",
          confidence: bestScore,
          hint,
        };
      }
    } catch {
      // Distillation failed
    }
    return null;
  }

  /** XPath text content search — last resort */
  private async findByXPathText(hint: string): Promise<FindElementResult | null> {
    try {
      const escapedHint = hint.replace(/'/g, "\\'");
      const result = await this.browser.evaluate<string>(
        `() => {
          const els = document.querySelectorAll('a,button,input,select,textarea,[role="button"]');
          for (const el of els) {
            const text = (el.textContent || el.value || el.placeholder || el.getAttribute('aria-label') || '').trim();
            if (text.toLowerCase().includes('${escapedHint}'.toLowerCase())) {
              return el.id ? '#' + el.id : el.name ? el.tagName.toLowerCase() + '[name="' + el.name + '"]' : '';
            }
          }
          return '';
        }`
      );
      if (result) {
        return {
          selector: result,
          strategy: "xpath",
          confidence: 0.6,
          hint,
        };
      }
    } catch {
      // XPath search failed
    }
    return null;
  }

  // ─── Helpers ───

  /** Score how well a distilled element matches a hint (0-1) */
  private scoreElementMatch(el: DistilledElement, normalizedHint: string): number {
    let score = 0;

    // Text match (strongest signal)
    const elText = el.text.toLowerCase().trim();
    if (elText === normalizedHint) score += 0.5;
    else if (elText.includes(normalizedHint)) score += 0.35;
    else if (normalizedHint.includes(elText) && elText.length > 2) score += 0.2;

    // ARIA label match
    if (el.ariaLabel) {
      const aria = el.ariaLabel.toLowerCase();
      if (aria === normalizedHint) score += 0.4;
      else if (aria.includes(normalizedHint)) score += 0.3;
    }

    // Placeholder match (for inputs)
    if (el.placeholder) {
      const ph = el.placeholder.toLowerCase();
      if (ph.includes(normalizedHint)) score += 0.3;
      else if (normalizedHint.includes(ph)) score += 0.2;
    }

    // Name attribute match
    if (el.name) {
      const name = el.name.toLowerCase();
      if (name === normalizedHint) score += 0.3;
      else if (name.includes(normalizedHint)) score += 0.2;
    }

    // Role match (weak signal, but helps disambiguate)
    const roleHint = this.extractRoleFromHint(normalizedHint);
    if (roleHint && el.role === roleHint) score += 0.1;

    return Math.min(score, 1.0);
  }

  /** Extract a role hint from the natural language hint */
  private extractRoleFromHint(hint: string): string | null {
    const roleKeywords: Record<string, string> = {
      "按钮": "button", "button": "button", "btn": "button",
      "链接": "link", "link": "link",
      "输入": "textbox", "input": "textbox", "文本框": "textbox",
      "下拉": "combobox", "select": "combobox", "dropdown": "combobox",
      "复选": "checkbox", "checkbox": "checkbox",
      "单选": "radio", "radio": "radio",
      "标签": "tab", "tab": "tab",
    };
    for (const [keyword, role] of Object.entries(roleKeywords)) {
      if (hint.includes(keyword)) return role;
    }
    return null;
  }

  /** Get the distilled page (with TTL cache) */
  private async getDistilledPage(): Promise<DistilledPage | null> {
    const now = Date.now();
    if (this.distilledCache && now - this.distilledCacheTime < SmartLocator.DISTILL_TTL) {
      return this.distilledCache;
    }

    try {
      const result = await this.browser.evaluate<string>(DISTILL_SCRIPT);
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      this.distilledCache = parsed as DistilledPage;
      this.distilledCacheTime = now;
      return this.distilledCache;
    } catch {
      return null;
    }
  }

  /** Verify that a CSS selector finds a visible element */
  private async verifySelector(selector: string, timeout: number): Promise<boolean> {
    try {
      // Quick check: is the element visible right now?
      const visible = await this.browser.isVisible(selector);
      if (visible) return true;

      // If not visible, wait up to timeout
      if (timeout > 0) {
        await this.browser.waitForSelector(selector, { timeout, visible: true });
        return true;
      }
    } catch {
      // Selector not found
    }
    return false;
  }

  /** Update the site profile cache with a successful lookup */
  private updateCacheEntry(hint: string, result: FindElementResult): void {
    if (!this.profile) return;

    const existing = this.profile.elementCache.findIndex(
      (c) => c.hint.toLowerCase().trim() === hint.toLowerCase().trim()
    );

    const entry: CachedElement = {
      hint,
      selector: result.selector,
      xpath: result.xpath,
      timestamp: Date.now(),
      hitCount: existing >= 0 ? (this.profile.elementCache[existing]?.hitCount ?? 0) + 1 : 1,
      lastVerified: Date.now(),
    };

    if (existing >= 0) {
      this.profile.elementCache[existing] = entry;
    } else {
      this.profile.elementCache.push(entry);
    }
    this.profile.updatedAt = Date.now();
  }
}
