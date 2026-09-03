/**
 * SiteProfile — per-target-site knowledge base for generalized testing.
 *
 * Instead of hard-coding selectors for each site, we capture semantic hints
 * that the LLM + SmartLocator use to locate elements. This is the key to
 * cross-site generalization: the same test intent works across different
 * sites because we describe "what" not "where".
 *
 * SiteProfile is populated:
 * 1. Manually — user provides hints upfront
 * 2. Automatically — SmartLocator caches successful lookups
 * 3. By exploration — observe phase discovers and records patterns
 */

/**
 * Authentication pattern description for a target site.
 * Uses semantic hints instead of CSS selectors.
 */
export interface AuthPattern {
  /** Authentication type */
  type: "form-login" | "oauth" | "sso" | "basic" | "none";
  /** URL or path to the login page */
  loginUrl?: string;
  /** Semantic hint for the username/email field (e.g., "用户名输入框") */
  usernameHint: string;
  /** Semantic hint for the password field */
  passwordHint: string;
  /** Semantic hint for the submit button */
  submitHint: string;
  /** Text that indicates successful login (e.g., "欢迎回来", "Dashboard") */
  successIndicator: string;
  /** Selectors cached from previous successful logins (self-healing) */
  cachedSelectors?: {
    username?: string;
    password?: string;
    submit?: string;
  };
}

/**
 * Describes a form pattern on the site.
 * Uses semantic hints for field identification.
 */
export interface FormPattern {
  /** Purpose of the form (e.g., "订单提交", "用户注册") */
  purpose: string;
  /** Semantic hints for form fields: field name → hint */
  fieldHints: Record<string, string>;
  /** Semantic hint for the submit button */
  submitHint: string;
  /** Text/condition indicating successful submission */
  successIndicator: string;
  /** URL pattern where this form typically appears */
  urlPattern?: string;
}

/**
 * Describes a navigation pattern on the site.
 */
export interface NavigationPattern {
  /** What this navigation achieves (e.g., "进入个人中心") */
  purpose: string;
  /** Starting point (e.g., "首页") */
  startFrom: string;
  /** Semantic description of the path (e.g., "点击右上角头像，然后点'个人中心'") */
  hint: string;
  /** URL pattern of the destination */
  destinationPattern?: string;
}

/**
 * Site-specific constraints that affect testing strategy.
 */
export interface SiteConstraints {
  /** Page loads slowly — increase wait times */
  slowLoad?: boolean;
  /** Site uses iframes heavily */
  hasIframes?: boolean;
  /** Site has CAPTCHA — may need human intervention */
  captcha?: boolean;
  /** Multi-factor authentication required */
  mfa?: boolean;
  /** Site uses shadow DOM */
  shadowDom?: boolean;
  /** Known anti-bot measures */
  antiBot?: boolean;
}

/**
 * Cached element mapping from previous successful interactions.
 * Used by SmartLocator for self-healing: if the cached selector works,
 * skip the expensive LLM/snapshot lookup.
 */
export interface CachedElement {
  /** Semantic hint that was used to find this element */
  hint: string;
  /** CSS selector that worked */
  selector: string;
  /** XPath as backup */
  xpath?: string;
  /** When this cache entry was created */
  timestamp: number;
  /** How many times this cache entry has been successfully used */
  hitCount: number;
  /** Last time this selector was verified to work */
  lastVerified: number;
}

/**
 * Complete site profile for a target website.
 * This is the configuration object that enables cross-site generalization.
 */
export interface SiteProfile {
  /** Human-readable site name */
  name: string;
  /** Base URL of the target site */
  baseUrl: string;
  /** Authentication pattern */
  auth?: AuthPattern;
  /** Known form patterns on this site */
  forms: FormPattern[];
  /** Known navigation patterns */
  navigations: NavigationPattern[];
  /** Site-specific constraints */
  constraints: SiteConstraints;
  /** Cached element selectors (self-healing) */
  elementCache: CachedElement[];
  /** Last time this profile was updated */
  updatedAt: number;
}

/**
 * Create a default/empty site profile for a given base URL.
 */
export function createDefaultSiteProfile(name: string, baseUrl: string): SiteProfile {
  return {
    name,
    baseUrl,
    forms: [],
    navigations: [],
    constraints: {},
    elementCache: [],
    updatedAt: Date.now(),
  };
}
