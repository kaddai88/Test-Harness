/**
 * SiteProfile Enricher — automatically learns site patterns from session data.
 *
 * After each session completes, the enricher analyzes:
 * 1. SmartLocator cache entries → discovers auth/form patterns
 * 2. Session activities → discovers navigation patterns
 * 3. Tool failures → discovers site constraints (slow load, CAPTCHA, etc.)
 *
 * This is the "self-learning" component of the generalization layer:
 * the more sessions run against a site, the richer the SiteProfile becomes,
 * and the faster/more reliable future sessions will be.
 */
import type { CachedElement } from "./site-profile.js";
import type { SiteProfile, AuthPattern, FormPattern, NavigationPattern, SiteConstraints } from "./site-profile.js";
import { createDefaultSiteProfile } from "./site-profile.js";

/** Session activity record — minimal interface for analysis */
export interface SessionActivity {
  kind: string;
  tool?: string;
  input?: Record<string, unknown>;
  success?: boolean;
  turn?: number;
  timestamp?: number;
}

/** Result of enrichment analysis */
export interface EnrichmentResult {
  /** New auth pattern discovered (if any) */
  authDiscovered?: boolean;
  /** New form patterns discovered */
  formsDiscovered: number;
  /** New navigation patterns discovered */
  navigationsDiscovered: number;
  /** New constraints discovered */
  constraintsDiscovered: boolean;
  /** Total cache entries after enrichment */
  totalCacheEntries: number;
  /** Summary of changes */
  summary: string;
}

/**
 * Enrich a SiteProfile based on session activities and SmartLocator cache.
 *
 * @param profile - Existing profile (or null to create new)
 * @param targetUrl - The target URL of the session
 * @param activities - Session activities (tool calls and results)
 * @param cache - SmartLocator element cache from the session
 * @returns Enrichment result with summary of changes
 */
export function enrichSiteProfile(
  profile: SiteProfile | null,
  targetUrl: string,
  activities: SessionActivity[],
  cache: CachedElement[]
): EnrichmentResult {
  const result: EnrichmentResult = {
    formsDiscovered: 0,
    navigationsDiscovered: 0,
    constraintsDiscovered: false,
    totalCacheEntries: cache.length,
    summary: '',
  };

  // Create profile if it doesn't exist
  const p = profile ?? createDefaultSiteProfile(
    extractHostname(targetUrl),
    targetUrl
  );

  const changes: string[] = [];

  // 1. Discover auth pattern from cache entries
  const authResult = discoverAuthPattern(p, cache, activities);
  if (authResult) {
    p.auth = authResult;
    result.authDiscovered = true;
    changes.push(`Auth pattern: ${authResult.type} login discovered`);
  }

  // 2. Discover form patterns from fill_form activities
  const formResult = discoverFormPatterns(p, activities);
  if (formResult.length > 0) {
    for (const form of formResult) {
      const existing = p.forms.findIndex(f => f.purpose === form.purpose);
      if (existing >= 0) {
        // Merge: update existing form pattern
        p.forms[existing] = { ...p.forms[existing], ...form };
      } else {
        p.forms.push(form);
        result.formsDiscovered++;
      }
    }
    if (result.formsDiscovered > 0) {
      changes.push(`${result.formsDiscovered} form pattern(s) discovered`);
    }
  }

  // 3. Discover navigation patterns from navigate_to sequences
  const navResult = discoverNavigationPatterns(p, activities);
  if (navResult.length > 0) {
    for (const nav of navResult) {
      const existing = p.navigations.findIndex(n => n.purpose === nav.purpose);
      if (existing < 0) {
        p.navigations.push(nav);
        result.navigationsDiscovered++;
      }
    }
    if (result.navigationsDiscovered > 0) {
      changes.push(`${result.navigationsDiscovered} navigation pattern(s) discovered`);
    }
  }

  // 4. Discover site constraints from failures and patterns
  const constraintResult = discoverConstraints(p, activities);
  if (constraintResult) {
    Object.assign(p.constraints, constraintResult);
    result.constraintsDiscovered = true;
    changes.push(`Constraints updated: ${Object.keys(constraintResult).join(', ')}`);
  }

  // 5. Update element cache (merge with existing)
  mergeElementCache(p, cache);

  // Update timestamp
  p.updatedAt = Date.now();

  // Build summary
  if (changes.length > 0) {
    result.summary = `Enriched ${p.name}: ${changes.join('; ')}`;
  } else {
    result.summary = `No new patterns discovered for ${p.name}`;
  }
  result.totalCacheEntries = p.elementCache.length;

  return result;
}

/**
 * Discover authentication pattern from session activities.
 *
 * Heuristics:
 * - fill_form with username/password-like fields followed by click on submit button
 * - Navigation from login URL to non-login URL
 * - Cache entries with hints like "用户名", "password", "login"
 */
function discoverAuthPattern(
  profile: SiteProfile,
  cache: CachedElement[],
  activities: SessionActivity[]
): AuthPattern | null {
  // Check if there's evidence of login in the cache
  const usernameCache = cache.find(c =>
    c.hint.toLowerCase().includes('用户') ||
    c.hint.toLowerCase().includes('username') ||
    c.hint.toLowerCase().includes('email') ||
    c.hint.toLowerCase().includes('账号')
  );
  const passwordCache = cache.find(c =>
    c.hint.toLowerCase().includes('密码') ||
    c.hint.toLowerCase().includes('password') ||
    c.hint.toLowerCase().includes('passwd')
  );
  const submitCache = cache.find(c =>
    c.hint.toLowerCase().includes('登录') ||
    c.hint.toLowerCase().includes('login') ||
    c.hint.toLowerCase().includes('signin') ||
    c.hint.toLowerCase().includes('提交')
  );

  // If we have all three components, it's likely a login form
  if (usernameCache && passwordCache && submitCache) {
    // Try to find the login URL from activities
    let loginUrl: string | undefined;
    let successIndicator = 'Dashboard';

    for (const activity of activities) {
      if ((activity.tool === 'navigate_to' || activity.tool === 'browser_navigate') && activity.input?.url) {
        const url = String(activity.input.url).toLowerCase();
        if (url.includes('login') || url.includes('signin') || url.includes('auth')) {
          loginUrl = String(activity.input.url);
        }
      }
      // Look for success indicators after login
      if ((activity.tool === 'observe_page' || activity.tool === 'browser_snapshot') && activity.success && loginUrl) {
        const elements = (activity.input as any)?.elements as Array<{ text?: string; role?: string }> | undefined;
        if (elements) {
          const dashboardHint = elements.find(el =>
            el.role === 'button' || el.role === 'link'
          );
          if (dashboardHint?.text) {
            successIndicator = dashboardHint.text;
          }
        }
      }
    }

    return {
      type: 'form-login',
      loginUrl,
      usernameHint: usernameCache.hint,
      passwordHint: passwordCache.hint,
      submitHint: submitCache.hint,
      successIndicator,
      cachedSelectors: {
        username: usernameCache.selector,
        password: passwordCache.selector,
        submit: submitCache.selector,
      },
    };
  }

  return null;
}

/**
 * Discover form patterns from fill_form activities.
 */
function discoverFormPatterns(
  profile: SiteProfile,
  activities: SessionActivity[]
): FormPattern[] {
  const patterns: FormPattern[] = [];
  // Support both legacy and MCP tool names
  const formActivities = activities.filter(a =>
    (a.tool === 'fill_form' || a.tool === 'browser_fill_form') && a.success && a.input
  );

  // Group form fills by approximate URL/context
  const formGroups = new Map<string, SessionActivity[]>();
  for (const activity of formActivities) {
    const url = String(activity.input?.url ?? activity.input?.formSelector ?? 'unknown');
    const key = url.split('?')[0] ?? 'unknown'; // Normalize URL
    if (!formGroups.has(key)) {
      formGroups.set(key, []);
    }
    formGroups.get(key)!.push(activity);
  }

  for (const [url, group] of formGroups) {
    if (group.length === 0) continue;

    // Extract field hints from the form data
    const fieldHints: Record<string, string> = {};
    let submitHint = 'Submit';

    for (const activity of group) {
      const data = activity.input?.data as Record<string, string> | undefined;
      if (data) {
        for (const key of Object.keys(data)) {
          // Use the field name as the hint
          fieldHints[key] = key;
        }
      }
    }

    // Skip if this looks like a login form (already handled by auth pattern)
    const isLogin = Object.keys(fieldHints).some(k =>
      k.toLowerCase().includes('password') ||
      k.toLowerCase().includes('密码') ||
      k.toLowerCase().includes('username') ||
      k.toLowerCase().includes('用户')
    );
    if (isLogin) continue;

    if (Object.keys(fieldHints).length > 0) {
      patterns.push({
        purpose: `Form at ${url}`,
        fieldHints,
        submitHint,
        successIndicator: 'Form submitted successfully',
        urlPattern: url,
      });
    }
  }

  return patterns;
}

/**
 * Discover navigation patterns from navigate_to sequences.
 */
function discoverNavigationPatterns(
  profile: SiteProfile,
  activities: SessionActivity[]
): NavigationPattern[] {
  const patterns: NavigationPattern[] = [];
  const navActivities = activities.filter(a =>
    (a.tool === 'navigate_to' || a.tool === 'browser_navigate') && a.success && a.input?.url
  );

  // Look for sequences: navigate → observe → navigate → observe
  // These indicate navigation paths the agent discovered
  for (let i = 0; i < navActivities.length - 1; i++) {
    const from = navActivities[i]!;
    const to = navActivities[i + 1]!;
    const fromUrl = String(from.input?.url ?? '');
    const toUrl = String(to.input?.url ?? '');

    // Skip if same URL or login-related
    if (fromUrl === toUrl) continue;
    if (toUrl.toLowerCase().includes('login') || toUrl.toLowerCase().includes('signin')) continue;

    // Extract a meaningful purpose from the URL
    const toPath = new URL(toUrl).pathname;
    const purpose = `Navigate to ${toPath}`;

    // Check if we already have this pattern
    const existing = profile.navigations.find(n =>
      n.destinationPattern === toPath || n.purpose === purpose
    );
    if (!existing) {
      patterns.push({
        purpose,
        startFrom: extractHostname(fromUrl) ?? 'unknown',
        hint: `Navigate from ${fromUrl} to ${toUrl}`,
        destinationPattern: toPath,
      });
    }
  }

  return patterns;
}

/**
 * Discover site constraints from session failures and patterns.
 */
function discoverConstraints(
  profile: SiteProfile,
  activities: SessionActivity[]
): Partial<SiteConstraints> | null {
  const constraints: Partial<SiteConstraints> = {};

  // Check for slow page loads (many timeouts or long durations)
  const failedNavigations = activities.filter(a =>
    (a.tool === 'navigate_to' || a.tool === 'browser_navigate') && !a.success
  );
  if (failedNavigations.length >= 3) {
    constraints.slowLoad = true;
  }

  // Check for iframe-related failures
  const iframeFailures = activities.filter(a =>
    !a.success && a.input && JSON.stringify(a.input).toLowerCase().includes('iframe')
  );
  if (iframeFailures.length >= 2) {
    constraints.hasIframes = true;
  }

  // Check for CAPTCHA indicators
  const captchaIndicators = activities.filter(a =>
    (a.tool === 'observe_page' || a.tool === 'browser_snapshot') && a.success && a.input &&
    JSON.stringify(a.input).toLowerCase().includes('captcha')
  );
  if (captchaIndicators.length > 0) {
    constraints.captcha = true;
  }

  return Object.keys(constraints).length > 0 ? constraints : null;
}

/**
 * Merge new cache entries with existing ones, preferring newer/more-hit entries.
 */
function mergeElementCache(profile: SiteProfile, newCache: CachedElement[]): void {
  for (const entry of newCache) {
    const existing = profile.elementCache.findIndex(
      c => c.hint.toLowerCase().trim() === entry.hint.toLowerCase().trim()
    );

    if (existing >= 0) {
      const existingEntry = profile.elementCache[existing]!;
      // Update if newer or more hits
      if (entry.timestamp > existingEntry.timestamp ||
          entry.hitCount > existingEntry.hitCount) {
        profile.elementCache[existing] = entry;
      }
    } else {
      profile.elementCache.push(entry);
    }
  }
}

/** Extract hostname from URL */
function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
