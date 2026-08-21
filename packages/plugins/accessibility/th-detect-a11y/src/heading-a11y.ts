/**
 * Heading Accessibility Detector — checks heading structure.
 *
 * Checks for:
 * - Missing <h1> → medium
 * - Skipped heading levels (e.g., h1 → h3 without h2) → medium
 * - Empty headings → medium
 */
import type {
  DetectionPlugin,
  DetectionTarget,
  DetectionContext,
  DetectionResult,
  Finding,
} from "@test-harness/th-protocol";
import { calculateScore } from "@test-harness/th-detection";

interface HeadingInfo {
  level: number;
  text: string;
  tag: string;
}

export class HeadingAccessibilityDetector implements DetectionPlugin {
  readonly id = "a11y-headings";
  readonly name = "Heading Structure Check";
  readonly category = "accessibility" as const;
  readonly description =
    "Checks heading accessibility: h1 presence, heading level order, empty headings";
  readonly version = "1.0.0";

  async execute(
    target: DetectionTarget,
    _context: DetectionContext
  ): Promise<DetectionResult> {
    const findings: Finding[] = [];
    const html = target.pageData?.html ?? "";

    // Extract all heading tags
    const headingRegex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
    const headings: HeadingInfo[] = [];
    let match: RegExpExecArray | null;

    while ((match = headingRegex.exec(html)) !== null) {
      const level = parseInt(match[1]!, 10);
      const innerContent = match[2] ?? "";
      const text = innerContent.replace(/<[^>]+>/g, "").trim();
      headings.push({
        level,
        text,
        tag: match[0]!,
      });
    }

    // Check for missing h1
    const hasH1 = headings.some((h) => h.level === 1);
    if (!hasH1) {
      findings.push({
        id: "missing-h1",
        title: "Missing H1 Heading",
        severity: "medium",
        confidence: "certain",
        description:
          "The page has no <h1> heading. Every page should have exactly one h1 as the primary heading for accessibility and SEO.",
        evidence: {
          type: "dom_element",
          data: `Found headings: [${headings
            .map((h) => `h${h.level}`)
            .join(", ") || "(none)"}]`,
          context: `URL: ${target.url}`,
        },
        recommendation:
          "Add a single <h1> heading that clearly describes the page's main topic.",
        url: target.url,
      });
    }

    // Check for skipped heading levels
    let prevLevel = 0;
    for (const [idx, h] of headings.entries()) {
      if (prevLevel > 0 && h.level > prevLevel + 1) {
        findings.push({
          id: `skipped-heading-${idx}`,
          title: `Skipped Heading Level: h${prevLevel} to h${h.level}`,
          severity: "medium",
          confidence: "certain",
          description: `Heading level skipped from h${prevLevel} to h${h.level}. Heading levels should increment by one at a time to maintain a logical document outline.`,
          evidence: {
            type: "dom_element",
            data: h.tag.trim(),
            context: `URL: ${target.url}`,
          },
          recommendation: `Insert an h${prevLevel + 1} between the h${prevLevel} and h${h.level}, or restructure the headings.`,
          element: h.tag,
          url: target.url,
        });
      }
      prevLevel = h.level;
    }

    // Check for empty headings
    for (const [idx, h] of headings.entries()) {
      if (h.text === "") {
        findings.push({
          id: `empty-heading-${idx}`,
          title: `Empty h${h.level} Heading`,
          severity: "medium",
          confidence: "certain",
          description: `An <h${h.level}> heading is empty. Empty headings are confusing for screen reader users navigating by headings.`,
          evidence: {
            type: "dom_element",
            data: h.tag.trim(),
            context: `URL: ${target.url}`,
          },
          recommendation:
            "Add meaningful text to the heading, or remove the empty heading element.",
          element: h.tag,
          url: target.url,
        });
      }
    }

    return {
      detectionId: this.id,
      category: this.category,
      status: "completed",
      findings,
      score: calculateScore(findings),
      metadata: {
        headingsFound: headings.length,
        hasH1,
        h1Count: headings.filter((h) => h.level === 1).length,
      },
      startedAt: new Date(),
      completedAt: new Date(),
    };
  }

  async canExecute(
    target: DetectionTarget,
    _context: DetectionContext
  ): Promise<boolean> {
    return !!target.pageData?.html;
  }
}
