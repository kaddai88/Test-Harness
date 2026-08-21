/**
 * Robots & Sitemap Detector — checks robots.txt and sitemap.xml.
 *
 * Checks for:
 * - Fetches /robots.txt, checks if it exists → info if missing
 * - Checks for Sitemap directive in robots.txt → medium if missing
 * - Checks for sitemap.xml existence → low if missing
 */
import type {
  DetectionPlugin,
  DetectionTarget,
  DetectionContext,
  DetectionResult,
  Finding,
} from "@test-harness/th-protocol";
import { calculateScore } from "@test-harness/th-detection";

export class RobotsSitemapDetector implements DetectionPlugin {
  readonly id = "robots-sitemap";
  readonly name = "Robots.txt & Sitemap Check";
  readonly category = "seo" as const;
  readonly description =
    "Checks for robots.txt, Sitemap directive, and sitemap.xml existence";
  readonly version = "1.0.0";

  async execute(
    target: DetectionTarget,
    _context: DetectionContext
  ): Promise<DetectionResult> {
    const findings: Finding[] = [];
    const baseUrl = this.getBaseUrl(target.url);

    let robotsExists = false;
    let robotsContent = "";

    // Fetch robots.txt
    try {
      const robotsResponse = await fetch(`${baseUrl}/robots.txt`, {
        signal: AbortSignal.timeout(10000),
      });
      if (robotsResponse.ok) {
        robotsExists = true;
        robotsContent = await robotsResponse.text();
      } else {
        findings.push({
          id: "missing-robots-txt",
          title: "Missing robots.txt",
          severity: "info",
          confidence: "certain",
          description:
            "No robots.txt file was found at the site root. While not required, robots.txt is a conventional way to guide crawlers.",
          evidence: {
            type: "http_response",
            data: `${baseUrl}/robots.txt returned status ${robotsResponse.status}`,
            context: `URL: ${target.url}`,
          },
          recommendation:
            "Add a /robots.txt file with appropriate directives (even an empty file is valid).",
          references: ["https://developers.google.com/search/docs/crawling-indexing/robots/intro"],
          url: target.url,
        });
      }
    } catch {
      findings.push({
        id: "robots-txt-unreachable",
        title: "robots.txt Unreachable",
        severity: "info",
        confidence: "tentative",
        description: "Could not fetch /robots.txt — the request timed out or failed.",
        evidence: {
          type: "http_response",
          data: "Request to /robots.txt failed",
          context: `URL: ${target.url}`,
        },
        recommendation:
          "Ensure /robots.txt is accessible to public crawlers.",
        url: target.url,
      });
    }

    // Check for Sitemap directive
    if (robotsExists) {
      const sitemapDirective = robotsContent.match(
        /^Sitemap:\s*(.+)$/im
      );
      if (!sitemapDirective) {
        findings.push({
          id: "no-sitemap-directive",
          title: "No Sitemap Directive in robots.txt",
          severity: "medium",
          confidence: "certain",
          description:
            "The robots.txt file exists but does not include a Sitemap directive. Search engines use this to discover your sitemap.",
          evidence: {
            type: "http_response",
            data: "No 'Sitemap:' directive found in robots.txt",
            context: `URL: ${target.url}`,
          },
          recommendation:
            'Add "Sitemap: https://example.com/sitemap.xml" to robots.txt.',
          url: target.url,
        });
      }
    }

    // Fetch sitemap.xml
    try {
      const sitemapResponse = await fetch(`${baseUrl}/sitemap.xml`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!sitemapResponse.ok) {
        findings.push({
          id: "missing-sitemap-xml",
          title: "Missing sitemap.xml",
          severity: "low",
          confidence: "certain",
          description:
            "No sitemap.xml was found at the site root. Sitemaps help search engines discover all pages.",
          evidence: {
            type: "http_response",
            data: `${baseUrl}/sitemap.xml returned status ${sitemapResponse.status}`,
            context: `URL: ${target.url}`,
          },
          recommendation:
            "Create a sitemap.xml listing all important pages and reference it in robots.txt.",
          references: [
            "https://www.sitemaps.org/protocol.html",
          ],
          url: target.url,
        });
      }
    } catch {
      findings.push({
        id: "sitemap-unreachable",
        title: "sitemap.xml Unreachable",
        severity: "low",
        confidence: "tentative",
        description:
          "Could not fetch /sitemap.xml — the request timed out or failed.",
        evidence: {
          type: "http_response",
          data: "Request to /sitemap.xml failed",
          context: `URL: ${target.url}`,
        },
        recommendation: "Ensure /sitemap.xml is accessible.",
        url: target.url,
      });
    }

    return {
      detectionId: this.id,
      category: this.category,
      status: "completed",
      findings,
      score: calculateScore(findings),
      metadata: {
        robotsExists,
        hasSitemapDirective: /Sitemap:/im.test(robotsContent),
      },
      startedAt: new Date(),
      completedAt: new Date(),
    };
  }

  async canExecute(
    _target: DetectionTarget,
    _context: DetectionContext
  ): Promise<boolean> {
    return true;
  }

  private getBaseUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return url;
    }
  }
}
