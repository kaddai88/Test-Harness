/**
 * Navigation Detector — checks for dead links, mixed content, and missing alt
 * on linked images.
 *
 * Checks for:
 * - Broken/dead hrefs (empty, javascript:void, #-only without anchor target)
 * - Mixed content (http:// links on an https:// page)
 * - Linked images missing alt text
 */
import type {
  DetectionPlugin,
  DetectionTarget,
  DetectionContext,
  DetectionResult,
  Finding,
} from "@test-harness/th-protocol";
import { calculateScore } from "@test-harness/th-detection";

export class NavigationDetector implements DetectionPlugin {
  readonly id = "navigation";
  readonly name = "Navigation Check";
  readonly category = "functionality" as const;
  readonly description =
    "Checks for dead links, mixed content, and missing alt on linked images";
  readonly version = "1.0.0";

  async execute(
    target: DetectionTarget,
    _context: DetectionContext
  ): Promise<DetectionResult> {
    const findings: Finding[] = [];
    const dom = target.domExtract ?? target.pageData?.dom;

    if (!dom) {
      return {
        detectionId: this.id,
        category: this.category,
        status: "skipped",
        findings: [],
        score: 100,
        metadata: { reason: "No DOM extract available" },
        startedAt: new Date(),
        completedAt: new Date(),
      };
    }

    const links = dom.links ?? [];
    const images = dom.images ?? [];
    const html = target.pageData?.html ?? "";
    const isHttps = target.url.startsWith("https://");

    // Check 1: Dead/broken links
    for (const link of links) {
      const href = link.href.trim();

      // Empty href
      if (href === "" || href === "#") {
        findings.push({
          id: `dead-link-empty-${sanitizeId(link.text.slice(0, 30))}`,
          title: `Empty or Fragment-Only Link`,
          severity: "low",
          confidence: "certain",
          description: `Link with text "${link.text.slice(0, 50)}" has an empty or "#" href, which may confuse users or act as a broken placeholder.`,
          evidence: {
            type: "dom_element",
            data: `<a href="${href}">${link.text}</a>`,
            context: `URL: ${target.url}`,
          },
          recommendation:
            "Provide a valid destination URL or remove the link if it is a placeholder.",
          url: target.url,
        });
      }

      // javascript:void(0) links
      if (href.toLowerCase().startsWith("javascript:")) {
        findings.push({
          id: `dead-link-js-${sanitizeId(link.text.slice(0, 30))}`,
          title: `Link Uses javascript: Protocol`,
          severity: "medium",
          confidence: "certain",
          description: `Link "${link.text.slice(0, 50)}" uses the javascript: protocol. This is fragile and fails when JavaScript is disabled.`,
          evidence: {
            type: "dom_element",
            data: `<a href="${href}">${link.text}</a>`,
            context: `URL: ${target.url}`,
          },
          recommendation:
            "Use a <button> element with a click handler instead of a javascript: link, or provide a real URL fallback.",
          url: target.url,
        });
      }

      // Check 2: Mixed content — http links on https page
      if (isHttps && href.startsWith("http://")) {
        findings.push({
          id: `mixed-content-${sanitizeId(href.slice(0, 60))}`,
          title: `Mixed Content: HTTP Link on HTTPS Page`,
          severity: "medium",
          confidence: "certain",
          description: `Link "${href.slice(0, 80)}" uses http:// on an https:// page. Browsers may block or warn about this content.`,
          evidence: {
            type: "dom_element",
            data: `<a href="${href}">${link.text}</a>`,
            context: `Page URL: ${target.url}`,
          },
          recommendation:
            "Update the link to use https:// if the target supports it, or remove it if unavailable.",
          references: [
            "https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content",
          ],
          url: target.url,
        });
      }
    }

    // Check 3: Images missing alt (especially linked images)
    // Parse HTML for <a><img ...></a> patterns
    const linkedImgRegex =
      /<a\b[^>]*>[\s\S]*?<img\b([^>]*)>[\s\S]*?<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = linkedImgRegex.exec(html)) !== null) {
      const imgAttrs = match[1] ?? "";
      const hasAlt = /\balt\s*=\s*["'][^"']+["']/i.test(imgAttrs);
      const srcMatch = /src\s*=\s*["']([^"']+)["']/i.exec(imgAttrs);
      const imgSrc = srcMatch?.[1] ?? "unknown";

      if (!hasAlt) {
        findings.push({
          id: `linked-img-no-alt-${sanitizeId(imgSrc.slice(0, 40))}`,
          title: `Linked Image Missing Alt Text`,
          severity: "high",
          confidence: "certain",
          description: `An image inside a link is missing alt text. Screen readers cannot describe what this link does.`,
          evidence: {
            type: "dom_element",
            data: match[0].slice(0, 200),
            context: `URL: ${target.url}`,
          },
          recommendation:
            "Add descriptive alt text to the image that conveys the link's purpose (e.g., alt='Home' for a logo link).",
          url: target.url,
        });
      }
    }

    // Also flag images in the DOMExtract that have empty alt
    for (const img of images) {
      if (img.alt === "" && img.src) {
        // Skip if already caught in the HTML regex above
        const alreadyFound = findings.some(
          (f) => f.id.includes(sanitizeId(img.src.slice(0, 40)))
        );
        if (!alreadyFound) {
          findings.push({
            id: `img-empty-alt-${sanitizeId(img.src.slice(0, 40))}`,
            title: `Image with Empty Alt Attribute`,
            severity: "low",
            confidence: "tentative",
            description: `Image "${img.src.slice(0, 80)}" has an empty alt attribute. If the image is decorative this is fine, but informative images need alt text.`,
            evidence: {
              type: "dom_element",
              data: `<img src="${img.src}" alt="">`,
              context: `URL: ${target.url}`,
            },
            recommendation:
              "If the image conveys information, add descriptive alt text. If purely decorative, consider using CSS backgrounds instead.",
            url: target.url,
          });
        }
      }
    }

    return {
      detectionId: this.id,
      category: this.category,
      status: "completed",
      findings,
      score: calculateScore(findings),
      metadata: {
        linksChecked: links.length,
        imagesChecked: images.length,
        isHttpsPage: isHttps,
      },
      startedAt: new Date(),
      completedAt: new Date(),
    };
  }

  async canExecute(
    target: DetectionTarget,
    _context: DetectionContext
  ): Promise<boolean> {
    return !!(target.domExtract ?? target.pageData?.dom ?? target.pageData?.html);
  }
}

/** Sanitize a string for use in a finding ID */
function sanitizeId(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}
