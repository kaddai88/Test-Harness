/**
 * Image Accessibility Detector — checks image accessibility.
 *
 * Checks for:
 * - <img> without alt attribute → high
 * - <img> with empty alt="" (ok if decorative, but flag if seems non-decorative) → info
 * - <img> with alt that looks like a filename (contains .jpg, .png, etc) → medium
 */
import type {
  DetectionPlugin,
  DetectionTarget,
  DetectionContext,
  DetectionResult,
  Finding,
} from "@test-harness/th-protocol";
import { calculateScore } from "@test-harness/th-detection";

const FILENAME_PATTERN = /\.(jpe?g|png|gif|webp|svg|bmp|ico|avif)(\?|$)/i;

/** Heuristic: srcs that look like generic decoration (icons, spacers, bg) */
const DECORATIVE_PATTERN = /(spacer|divider|blank|transparent|icon|decoration|bg|background|border|pixel)/i;

export class ImageAccessibilityDetector implements DetectionPlugin {
  readonly id = "a11y-images";
  readonly name = "Image Accessibility Check";
  readonly category = "accessibility" as const;
  readonly description =
    "Checks image accessibility: missing alt attributes, empty alt on non-decorative images, filename-as-alt";
  readonly version = "1.0.0";

  async execute(
    target: DetectionTarget,
    _context: DetectionContext
  ): Promise<DetectionResult> {
    const findings: Finding[] = [];
    const html = target.pageData?.html ?? "";

    // Match all <img> tags (self-closing or not)
    const imgRegex = /<img\b([^>]*)>/gi;
    let match: RegExpExecArray | null;

    while ((match = imgRegex.exec(html)) !== null) {
      const fullTag = match[0]!;
      const attrs = match[1] ?? "";

      // Extract src
      const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
      const src = srcMatch ? srcMatch[1]! : "(no src)";

      // Check for alt attribute
      const hasAltAttr = /\balt\s*=/i.test(attrs);

      if (!hasAltAttr) {
        findings.push({
          id: `img-missing-alt-${findings.length}`,
          title: "Image Missing alt Attribute",
          severity: "high",
          confidence: "certain",
          description:
            "An <img> element is missing the alt attribute. Screen readers cannot describe the image to visually impaired users.",
          evidence: {
            type: "dom_element",
            data: `<img src="${src}"> (no alt attribute)`,
            context: `URL: ${target.url}`,
          },
          recommendation:
            'Add an alt attribute describing the image, or alt="" if purely decorative.',
          element: fullTag,
          references: [
            "https://www.w3.org/WAI/tutorials/images/",
          ],
          url: target.url,
        });
        continue;
      }

      // Extract alt value
      const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
      const altValue = altMatch ? altMatch[1]! : "";

      // Empty alt — flag if the image doesn't look decorative
      if (altValue.trim() === "") {
        const isDecorativeSrc = DECORATIVE_PATTERN.test(src);
        if (!isDecorativeSrc && src !== "(no src)") {
          findings.push({
            id: `img-empty-alt-${findings.length}`,
            title: "Empty alt on Potentially Non-Decorative Image",
            severity: "info",
            confidence: "tentative",
            description:
              "An <img> has an empty alt attribute. This is appropriate for decorative images, but if the image conveys meaning, it should have a descriptive alt.",
            evidence: {
              type: "dom_element",
              data: `<img src="${src}" alt="">`,
              context: `URL: ${target.url}`,
            },
            recommendation:
              "If the image is decorative, keep alt=\"\". Otherwise, add a descriptive alt value.",
            element: fullTag,
            url: target.url,
          });
        }
        continue;
      }

      // alt value looks like a filename
      if (FILENAME_PATTERN.test(altValue)) {
        findings.push({
          id: `img-alt-filename-${findings.length}`,
          title: "Image alt Attribute Looks Like a Filename",
          severity: "medium",
          confidence: "firm",
          description: `The alt attribute "${altValue}" appears to be a filename rather than a meaningful description.`,
          evidence: {
            type: "dom_element",
            data: `<img src="${src}" alt="${altValue}">`,
            context: `URL: ${target.url}`,
          },
          recommendation:
            "Replace the filename in the alt attribute with a descriptive phrase about what the image shows.",
          element: fullTag,
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
        imagesScanned: (html.match(/<img\b/gi) ?? []).length,
        findingsCount: findings.length,
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
