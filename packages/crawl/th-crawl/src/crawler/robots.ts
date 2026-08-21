/**
 * Robots.txt parser — respects crawl policies.
 */
import { fetch as undiciFetch } from "undici";

export interface RobotsPolicy {
  allowed: (path: string, userAgent?: string) => boolean;
  sitemaps: string[];
  crawlDelay?: number;
}

export class RobotsParser {
  /** Fetch and parse robots.txt for a given base URL */
  async parse(baseUrl: string): Promise<RobotsPolicy> {
    const robotsUrl = new URL("/robots.txt", baseUrl).href;
    let content = "";

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await undiciFetch(robotsUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (response.status === 200) {
        content = await response.text();
      }
    } catch {
      // If robots.txt is unreachable, allow everything
    }

    return this.parseContent(content);
  }

  /** Parse robots.txt content */
  parseContent(content: string): RobotsPolicy {
    const rules: Array<{
      userAgents: string[];
      disallows: string[];
      allows: string[];
    }> = [];
    const sitemaps: string[] = [];
    let crawlDelay: number | undefined;

    let currentUserAgents: string[] = [];
    let currentDisallows: string[] = [];
    let currentAllows: string[] = [];

    for (const rawLine of content.split("\n")) {
      const line = rawLine.split("#")[0]!.trim();
      if (!line) continue;

      const colonIdx = line.indexOf(":");
      if (colonIdx < 0) continue;

      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();

      switch (key) {
        case "user-agent":
          if (currentUserAgents.length > 0) {
            rules.push({
              userAgents: currentUserAgents,
              disallows: currentDisallows,
              allows: currentAllows,
            });
          }
          currentUserAgents = [value.toLowerCase()];
          currentDisallows = [];
          currentAllows = [];
          break;
        case "disallow":
          currentDisallows.push(value);
          break;
        case "allow":
          currentAllows.push(value);
          break;
        case "sitemap":
          sitemaps.push(value);
          break;
        case "crawl-delay":
          crawlDelay = parseInt(value, 10);
          break;
      }
    }

    if (currentUserAgents.length > 0) {
      rules.push({
        userAgents: currentUserAgents,
        disallows: currentDisallows,
        allows: currentAllows,
      });
    }

    return {
      sitemaps,
      crawlDelay,
      allowed: (path: string, userAgent = "*"): boolean => {
        // Find matching rule set (specific UA first, then wildcard)
        const specific = rules.find((r) =>
          r.userAgents.includes(userAgent.toLowerCase())
        );
        const wildcard = rules.find((r) =>
          r.userAgents.includes("*")
        );
        const rule = specific ?? wildcard;
        if (!rule) return true;

        // Check if any disallow pattern matches
        for (const pattern of rule.disallows) {
          if (matchesPattern(path, pattern)) {
            // Check if a more specific allow overrides
            for (const allowPattern of rule.allows) {
              if (
                matchesPattern(path, allowPattern) &&
                allowPattern.length > pattern.length
              ) {
                return true;
              }
            }
            return false;
          }
        }
        return true;
      },
    };
  }
}

/** Simple pattern matching for robots.txt paths */
function matchesPattern(path: string, pattern: string): boolean {
  if (pattern.endsWith("$")) {
    return path === pattern.slice(0, -1);
  }
  if (pattern.includes("*")) {
    const regex = new RegExp(
      "^" +
        pattern
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
    );
    return regex.test(path);
  }
  return path.startsWith(pattern);
}
