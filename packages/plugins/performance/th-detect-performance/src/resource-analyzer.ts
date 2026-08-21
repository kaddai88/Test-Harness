/**
 * Resource Analyzer — analyzes HTML for performance issues.
 *
 * Checks for:
 * - Counts <script> tags (many scripts → medium)
 * - Checks for <script async> or <script defer> usage
 * - Counts inline <style> blocks
 * - Checks for lazy-loaded images (loading="lazy")
 * - Checks for <img> without width/height (causes CLS) → medium
 */
import type {
  DetectionPlugin,
  DetectionTarget,
  DetectionContext,
  DetectionResult,
  Finding,
} from "@test-harness/th-protocol";
import { calculateScore } from "@test-harness/th-detection";

const SCRIPT_THRESHOLD = 10;

export class ResourceAnalyzer implements DetectionPlugin {
  readonly id = "resource-analyzer";
  readonly name = "Resource Analysis";
  readonly category = "performance" as const;
  readonly description =
    "Analyzes HTML for performance issues: script count, async/defer usage, inline styles, lazy images, and CLS-causing images";
  readonly version = "1.0.0";

  async execute(
    target: DetectionTarget,
    _context: DetectionContext
  ): Promise<DetectionResult> {
    const findings: Finding[] = [];
    const html = target.pageData?.html ?? "";

    // Count <script> tags
    const scriptMatches = html.match(/<script[\s>]/gi) ?? [];
    const scriptCount = scriptMatches.length;

    if (scriptCount > SCRIPT_THRESHOLD) {
      findings.push({
        id: "too-many-scripts",
        title: "Excessive Number of Script Tags",
        severity: "medium",
        confidence: "certain",
        description: `Found ${scriptCount} <script> tags on the page. A large number of scripts increases download, parse, and execution time.`,
        evidence: {
          type: "dom_element",
          data: `${scriptCount} <script> elements detected`,
          context: `URL: ${target.url}`,
        },
        recommendation:
          "Bundle scripts together, use code-splitting, or load non-critical scripts dynamically.",
        url: target.url,
      });
    }

    // Check for async/defer usage on external scripts
    const externalScriptRegex =
      /<script[^>]+src=["'][^"']+["'][^>]*>/gi;
    const externalScripts = html.match(externalScriptRegex) ?? [];
    const scriptsMissingAsyncOrDefer = externalScripts.filter(
      (s) => !/\b(async|defer)\b/i.test(s)
    );

    if (
      externalScripts.length > 0 &&
      scriptsMissingAsyncOrDefer.length > 0
    ) {
      findings.push({
        id: "scripts-without-async-defer",
        title: "External Scripts Without async or defer",
        severity: "medium",
        confidence: "firm",
        description: `${scriptsMissingAsyncOrDefer.length} of ${externalScripts.length} external scripts lack async or defer attributes. These scripts block HTML parsing.`,
        evidence: {
          type: "dom_element",
          data: `${scriptsMissingAsyncOrDefer.length} scripts without async/defer`,
          context: `URL: ${target.url}`,
        },
        recommendation:
          'Add "async" or "defer" to external <script> tags to avoid blocking HTML parsing.',
        url: target.url,
      });
    }

    // Count inline <style> blocks
    const inlineStyleMatches = html.match(/<style[\s>]/gi) ?? [];
    const inlineStyleCount = inlineStyleMatches.length;
    if (inlineStyleCount > 5) {
      findings.push({
        id: "many-inline-styles",
        title: "Many Inline Style Blocks",
        severity: "low",
        confidence: "firm",
        description: `Found ${inlineStyleCount} inline <style> blocks. Excessive inline CSS increases HTML size and may prevent caching.`,
        evidence: {
          type: "dom_element",
          data: `${inlineStyleCount} inline <style> elements`,
          context: `URL: ${target.url}`,
        },
        recommendation:
          "Move large stylesheets to external CSS files so they can be cached by the browser.",
        url: target.url,
      });
    }

    // Check for lazy-loaded images
    const imgTags = html.match(/<img[\s>][^>]*>/gi) ?? [];
    const lazyImages = imgTags.filter((t) =>
      /loading=["']lazy["']/i.test(t)
    );
    const lazyCount = lazyImages.length;
    const totalImages = imgTags.length;

    if (totalImages > 5 && lazyCount === 0) {
      findings.push({
        id: "no-lazy-images",
        title: "No Lazy-Loaded Images",
        severity: "info",
        confidence: "tentative",
        description: `Found ${totalImages} images but none use loading="lazy". Lazy loading defers off-screen images, saving bandwidth.`,
        evidence: {
          type: "dom_element",
          data: `${totalImages} images, 0 lazy-loaded`,
          context: `URL: ${target.url}`,
        },
        recommendation:
          'Add loading="lazy" to off-screen <img> tags to defer their loading.',
        url: target.url,
      });
    }

    // Check for <img> without width/height (CLS)
    const imagesWithoutDimensions = imgTags.filter(
      (t) =>
        !/\bwidth\s*=/i.test(t) || !/\bheight\s*=/i.test(t)
    );

    if (imagesWithoutDimensions.length > 0) {
      findings.push({
        id: "images-without-dimensions",
        title: "Images Missing Width/Height Attributes",
        severity: "medium",
        confidence: "firm",
        description: `${imagesWithoutDimensions.length} <img> tags lack explicit width and height attributes. This causes Cumulative Layout Shift (CLS) as images load.`,
        evidence: {
          type: "dom_element",
          data: `${imagesWithoutDimensions.length} images without width/height`,
          context: `URL: ${target.url}`,
        },
        recommendation:
          "Add width and height attributes to all <img> tags matching the intrinsic dimensions of the image.",
        references: [
          "https://web.dev/cls/",
        ],
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
        scriptCount,
        externalScriptCount: externalScripts.length,
        scriptsWithoutAsyncDefer: scriptsMissingAsyncOrDefer.length,
        inlineStyleCount,
        imageCount: totalImages,
        lazyImageCount: lazyCount,
        imagesWithoutDimensions: imagesWithoutDimensions.length,
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
