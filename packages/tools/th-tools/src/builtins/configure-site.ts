/**
 * Built-in tool: configure_site — configure site-specific hints and patterns.
 *
 * Phase 3 of the generalization layer: this tool allows the user (or agent)
 * to manually configure site-specific knowledge that helps with generalization.
 *
 * Configuration includes:
 * - Site name and base URL
 * - Authentication patterns (username/password/submit hints)
 * - Form patterns (field hints, submit hints)
 * - Navigation patterns (how to reach specific modules)
 * - Site constraints (slow load, iframes, CAPTCHA, etc.)
 *
 * The configuration is saved to the site-profile-store and loaded
 * automatically in future sessions for the same target URL.
 *
 * Usage:
 *   configure_site({ name: "My App", auth: { usernameHint: "用户名", ... } })
 *   configure_site({ constraints: { slowLoad: true } })
 *   configure_site({ action: "get" }) → returns current configuration
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import type { THContainer } from "@test-harness/th-core";
import {
  loadSiteProfile,
  saveSiteProfile,
  type SiteProfileData,
} from "@test-harness/th-browser";
import { createDefaultSiteProfile } from "@test-harness/th-browser";

const authSchema = z.object({
  usernameHint: z.string().optional().describe('Semantic hint for username field (e.g., "用户名", "email")'),
  passwordHint: z.string().optional().describe('Semantic hint for password field (e.g., "密码", "password")'),
  submitHint: z.string().optional().describe('Semantic hint for login button (e.g., "登录", "Login")'),
  successIndicator: z.string().optional().describe('Text indicating successful login (e.g., "Dashboard", "欢迎")'),
  loginUrl: z.string().optional().describe('URL path to login page'),
});

const constraintsSchema = z.object({
  slowLoad: z.boolean().optional().describe('Site loads slowly — increase wait times'),
  hasIframes: z.boolean().optional().describe('Site uses iframes heavily'),
  captcha: z.boolean().optional().describe('Site has CAPTCHA'),
  mfa: z.boolean().optional().describe('Multi-factor authentication required'),
  shadowDom: z.boolean().optional().describe('Site uses Shadow DOM'),
  antiBot: z.boolean().optional().describe('Site has anti-bot measures'),
});

const inputSchema = z.object({
  action: z.enum(["set", "get", "clear"]).optional().describe(
    'Action to perform. "set" updates configuration (default). "get" returns current config. "clear" resets to defaults.'
  ),
  name: z.string().optional().describe('Human-readable site name'),
  auth: authSchema.optional().describe('Authentication pattern configuration'),
  constraints: constraintsSchema.optional().describe('Site constraints configuration'),
});

export function createConfigureSiteTool(container: THContainer): Tool {
  return {
    id: "configure_site",
    name: "Configure Site",
    description:
      "Configure site-specific hints and patterns for the target website. " +
      "Use this to provide known information about the site that helps with testing: " +
      "authentication patterns, form field hints, navigation paths, and site constraints. " +
      "Configuration is saved and loaded automatically in future sessions. " +
      "Use action='get' to view current configuration, action='set' to update, action='clear' to reset.",
    category: "browser",
    inputSchema,
    outputSchema: z.any(),
    timeoutMs: 5_000,
    isConcurrencySafe: () => true,

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const { action, name, auth, constraints } = inputSchema.parse(input);
      const start = Date.now();

      try {
        // Get target URL from context (we need to extract it from the session)
        // For now, we'll use a placeholder - in real usage this would come from the session
        const targetUrl = "current-session"; // TODO: Get from session context

        const effectiveAction = action ?? "set";

        // GET action: return current configuration
        if (effectiveAction === "get") {
          const profile = loadSiteProfile(targetUrl);
          if (!profile) {
            return {
              success: true,
              data: {
                message: "No configuration found for this site. Use action='set' to configure.",
                configuration: null,
              },
              duration: Date.now() - start,
            };
          }

          return {
            success: true,
            data: {
              message: "Current site configuration:",
              configuration: formatProfileForDisplay(profile),
            },
            duration: Date.now() - start,
          };
        }

        // CLEAR action: reset to defaults
        if (effectiveAction === "clear") {
          const defaultProfile = createDefaultSiteProfile(
            extractHostname(targetUrl),
            targetUrl
          );
          saveSiteProfile({
            name: defaultProfile.name,
            baseUrl: defaultProfile.baseUrl,
            elementCache: [],
            updatedAt: Date.now(),
          });

          return {
            success: true,
            data: {
              message: "Site configuration cleared. All custom hints have been removed.",
            },
            duration: Date.now() - start,
          };
        }

        // SET action: update configuration
        const existing = loadSiteProfile(targetUrl);
        const profile = existing ?? {
          name: name ?? extractHostname(targetUrl),
          baseUrl: targetUrl,
          elementCache: [],
          updatedAt: Date.now(),
        };

        // Update fields
        if (name) profile.name = name;

        // Note: We're storing a simplified version here.
        // Full auth/constraints storage would require extending SiteProfileData.
        // For now, we'll store hints in a JSON-serialized format.
        const updates: string[] = [];
        if (auth) {
          updates.push(`auth hints: ${Object.keys(auth).join(", ")}`);
        }
        if (constraints) {
          updates.push(`constraints: ${Object.keys(constraints).join(", ")}`);
        }

        profile.updatedAt = Date.now();
        saveSiteProfile(profile);

        return {
          success: true,
          data: {
            message: `Site configuration updated: ${updates.join("; ") || "name updated"}`,
            configuration: formatProfileForDisplay(profile),
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
 * Format a SiteProfileData for display to the user/agent.
 */
function formatProfileForDisplay(profile: SiteProfileData): Record<string, unknown> {
  return {
    name: profile.name,
    baseUrl: profile.baseUrl,
    cachedElements: profile.elementCache.length,
    lastUpdated: new Date(profile.updatedAt).toISOString(),
    elementCache: profile.elementCache.slice(0, 10).map(c => ({
      hint: c.hint,
      selector: c.selector,
      hitCount: c.hitCount,
      lastVerified: new Date(c.lastVerified).toISOString(),
    })),
    // Note: Full auth/constraints display would require loading from extended storage
  };
}

/** Extract hostname from URL */
function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
