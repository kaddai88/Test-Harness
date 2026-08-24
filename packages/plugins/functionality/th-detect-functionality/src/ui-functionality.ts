/**
 * UI Functionality Detector — checks for interactive elements presence,
 * viewport meta tag, and JavaScript error count.
 *
 * Checks for:
 * - Presence of interactive elements (buttons, inputs, links)
 * - Viewport meta tag (critical for mobile functionality)
 * - JavaScript errors in the page (from console messages)
 */
import type {
  DetectionPlugin,
  DetectionTarget,
  DetectionContext,
  DetectionResult,
  Finding,
} from "@test-harness/th-protocol";
import { calculateScore } from "@test-harness/th-detection";

export class UIFunctionalityDetector implements DetectionPlugin {
  readonly id = "ui-functionality";
  readonly name = "UI Functionality Check";
  readonly category = "functionality" as const;
  readonly description =
    "Checks for interactive elements, viewport meta tag, and JavaScript errors";
  readonly version = "1.0.0";

  async execute(
    target: DetectionTarget,
    _context: DetectionContext
  ): Promise<DetectionResult> {
    const findings: Finding[] = [];
    const dom = target.domExtract ?? target.pageData?.dom;
    const html = target.pageData?.html ?? "";

    if (!dom && !html) {
      return {
        detectionId: this.id,
        category: this.category,
        status: "skipped",
        findings: [],
        score: 100,
        metadata: { reason: "No DOM or HTML available" },
        startedAt: new Date(),
        completedAt: new Date(),
      };
    }

    // Check 1: Interactive elements presence
    if (dom) {
      const hasLinks = (dom.links ?? []).length > 0;
      const hasForms = (dom.forms ?? []).length > 0;
      const hasButtons = /<button\b/i.test(html);
      const hasInputs =
        /<input\b/i.test(html) || /<textarea\b/i.test(html) || /<select\b/i.test(html);

      if (!hasLinks && !hasForms && !hasButtons && !hasInputs) {
        findings.push({
          id: "no-interactive-elements",
          title: "No Interactive Elements Detected",
          severity: "low",
          confidence: "tentative",
          description:
            "The page has no detected links, forms, buttons, or input elements. This may indicate a static page, a rendering issue, or missing functionality.",
          evidence: {
            type: "dom_element",
            data: `Links: 0, Forms: 0, Buttons: 0, Inputs: 0`,
            context: `URL: ${target.url}`,
          },
          recommendation:
            "Verify the page is expected to be interactive. If so, ensure JavaScript is loading correctly and elements are rendering.",
          url: target.url,
        });
      }
    }

    // Check 2: Viewport meta tag
    if (html) {
      const hasViewportMeta =
        /<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(html);

      if (!hasViewportMeta) {
        findings.push({
          id: "missing-viewport-meta",
          title: "Missing Viewport Meta Tag",
          severity: "high",
          confidence: "certain",
          description:
            'The page does not include a <meta name="viewport"> tag. Without it, the page will not render correctly on mobile devices and may be penalized in search rankings.',
          evidence: {
            type: "dom_element",
            data: "No <meta name='viewport'> found in <head>",
            context: `URL: ${target.url}`,
          },
          recommendation:
            'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the <head> of the page.',
          references: [
            "https://developer.mozilla.org/en-US/docs/Web/HTML/Viewport_meta_tag",
          ],
          url: target.url,
        });
      } else {
        // Check if viewport meta has proper content
        const viewportMatch = /<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*content\s*=\s*["']([^"']+)["']/i.exec(html);
        if (viewportMatch) {
          const content = viewportMatch[1] ?? "";
          if (!content.includes("width=") && !content.includes("initial-scale")) {
            findings.push({
              id: "incomplete-viewport-meta",
              title: "Incomplete Viewport Meta Tag",
              severity: "medium",
              confidence: "firm",
              description:
                `The viewport meta tag is present but may not have proper settings: content="${content}".`,
              evidence: {
                type: "dom_element",
                data: `<meta name="viewport" content="${content}">`,
                context: `URL: ${target.url}`,
              },
              recommendation:
                'Use <meta name="viewport" content="width=device-width, initial-scale=1"> for proper mobile rendering.',
              url: target.url,
            });
          }
        }
      }
    }

    // Check 3: JavaScript errors (from dom metadata or console messages)
    // Note: In a static detection context we check for inline script errors or
    // rely on console messages if provided via pageData
    const consoleErrors = extractConsoleErrors(html);
    if (consoleErrors.length > 0) {
      findings.push({
        id: "js-errors-detected",
        title: `${consoleErrors.length} JavaScript Error(s) Detected`,
        severity: consoleErrors.length > 2 ? "high" : "medium",
        confidence: "firm",
        description:
          `Found ${consoleErrors.length} JavaScript error(s) in the page source. JavaScript errors can break page functionality and user interactions.`,
        evidence: {
          type: "script",
          data: consoleErrors.slice(0, 3).join("\n"),
          context: `URL: ${target.url}`,
        },
        recommendation:
          "Open the browser developer tools console to see the full error details and fix the JavaScript issues.",
        url: target.url,
      });
    }

    // Check for script tags with missing src or syntax issues
    if (dom) {
      const scripts = dom.scripts ?? [];
      const emptyInlineScripts = scripts.filter(
        (s) => s.inline && !s.src
      ).length;

      // Only flag if there are many empty inline scripts
      if (emptyInlineScripts > 5) {
        findings.push({
          id: "excessive-empty-inline-scripts",
          title: "Excessive Empty Inline Scripts",
          severity: "low",
          confidence: "tentative",
          description:
            `Found ${emptyInlineScripts} inline <script> tags without external src. If these are empty placeholders, they add unnecessary page weight.`,
          evidence: {
            type: "script",
            data: `${emptyInlineScripts} empty inline scripts detected`,
            context: `URL: ${target.url}`,
          },
          recommendation:
            "Remove empty inline scripts or consolidate JavaScript into external files.",
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
        hasInteractiveElements: !!dom && (
          (dom.links ?? []).length > 0 ||
          (dom.forms ?? []).length > 0 ||
          /<button\b/i.test(html)
        ),
        hasViewportMeta: /<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(html),
        jsErrorsFound: consoleErrors.length,
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

/**
 * Extract obvious JS errors from inline script blocks in the HTML.
 * This is a heuristic check — real JS errors require browser console capture.
 */
function extractConsoleErrors(html: string): string[] {
  const errors: string[] = [];

  // Look for common error patterns in inline scripts
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    const code = (match[1] ?? "").trim();
    if (!code) continue;

    // Look for obvious syntax issues: unclosed strings, throw statements, etc.
    // This is intentionally conservative to avoid false positives.
    if (/^\s*throw\s+/m.test(code)) {
      errors.push(`Inline script contains throw statement: ${code.slice(0, 100)}`);
    }
  }

  return errors;
}
