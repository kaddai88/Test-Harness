/**
 * Form Accessibility Detector — checks form accessibility.
 *
 * Checks for:
 * - <input> without associated <label> (no matching for/id, no aria-label, no aria-labelledby) → high
 * - <button> without text content → medium
 * - Missing type attribute on <input> → low
 */
import type {
  DetectionPlugin,
  DetectionTarget,
  DetectionContext,
  DetectionResult,
  Finding,
} from "@test-harness/th-protocol";
import { calculateScore } from "@test-harness/th-detection";

export class FormAccessibilityDetector implements DetectionPlugin {
  readonly id = "a11y-forms";
  readonly name = "Form Accessibility Check";
  readonly category = "accessibility" as const;
  readonly description =
    "Checks form accessibility: labels for inputs, button text, input types";
  readonly version = "1.0.0";

  async execute(
    target: DetectionTarget,
    _context: DetectionContext
  ): Promise<DetectionResult> {
    const findings: Finding[] = [];
    const html = target.pageData?.html ?? "";

    // Collect all <label for="..."> references
    const labelForIds = new Set<string>();
    const labelForRegex = /<label\b[^>]*\bfor=["']([^"']+)["'][^>]*>/gi;
    let labelMatch: RegExpExecArray | null;
    while ((labelMatch = labelForRegex.exec(html)) !== null) {
      labelForIds.add(labelMatch[1]!);
    }

    // Check <input> elements
    const inputRegex = /<input\b([^>]*)>/gi;
    let inputMatch: RegExpExecArray | null;
    let inputIndex = 0;

    while ((inputMatch = inputRegex.exec(html)) !== null) {
      const attrs = inputMatch[1] ?? "";
      const fullTag = inputMatch[0]!;

      // Skip hidden / submit / button / reset — they don't need labels
      const typeMatch = attrs.match(/type=["']([^"']+)["']/i);
      const type = typeMatch ? typeMatch[1]!.toLowerCase() : "";
      if (
        type === "hidden" ||
        type === "submit" ||
        type === "button" ||
        type === "reset" ||
        type === "image"
      ) {
        // Still check for missing type
        continue;
      }

      const idMatch = attrs.match(/\bid=["']([^"']+)["']/i);
      const id = idMatch ? idMatch[1]! : "";

      const hasAriaLabel = /\baria-label\s*=/i.test(attrs);
      const hasAriaLabelledBy = /\baria-labelledby\s*=/i.test(attrs);
      const hasTitle = /\btitle\s*=/i.test(attrs);
      const hasPlaceholder = /\bplaceholder\s*=/i.test(attrs);

      const hasLabel =
        (id !== "" && labelForIds.has(id)) ||
        hasAriaLabel ||
        hasAriaLabelledBy ||
        hasTitle;

      if (!hasLabel) {
        findings.push({
          id: `input-no-label-${inputIndex}`,
          title: "Input Without Associated Label",
          severity: "high",
          confidence: "certain",
          description:
            "An <input> element has no associated <label>, aria-label, or aria-labelledby. Screen reader users cannot determine the input's purpose.",
          evidence: {
            type: "dom_element",
            data: `<input${attrs ? " " + attrs.trim() : ""}>`,
            context: `URL: ${target.url}`,
          },
          recommendation:
            "Add a <label for=\"id\"> wrapping or associated with the input, or use aria-label / aria-labelledby.",
          element: fullTag,
          references: [
            "https://www.w3.org/WAI/tutorials/forms/labels/",
          ],
          url: target.url,
        });
      }

      // Missing type attribute
      if (!typeMatch) {
        findings.push({
          id: `input-no-type-${inputIndex}`,
          title: "Input Missing type Attribute",
          severity: "low",
          confidence: "certain",
          description:
            "An <input> element is missing the type attribute. It will default to type=\"text\", which may not match the intended input behavior (especially on mobile).",
          evidence: {
            type: "dom_element",
            data: `<input${attrs ? " " + attrs.trim() : ""}>`,
            context: `URL: ${target.url}`,
          },
          recommendation:
            "Add an explicit type attribute (text, email, tel, number, etc.).",
          element: fullTag,
          url: target.url,
        });
      }

      // Placeholder-only label (warning)
      if (hasPlaceholder && !hasLabel && !hasAriaLabel) {
        findings.push({
          id: `input-placeholder-only-${inputIndex}`,
          title: "Input Uses Placeholder as Only Label",
          severity: "medium",
          confidence: "firm",
          description:
            "An <input> uses placeholder text without a visible label. Placeholders disappear when the user types, which is confusing for accessibility and usability.",
          evidence: {
            type: "dom_element",
            data: `<input${attrs ? " " + attrs.trim() : ""}>`,
            context: `URL: ${target.url}`,
          },
          recommendation:
            "Add a visible <label> in addition to any placeholder text.",
          element: fullTag,
          url: target.url,
        });
      }

      inputIndex++;
    }

    // Check <button> elements
    const buttonRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
    let buttonMatch: RegExpExecArray | null;
    let buttonIndex = 0;

    while ((buttonMatch = buttonRegex.exec(html)) !== null) {
      const attrs = buttonMatch[1] ?? "";
      const innerContent = buttonMatch[2] ?? "";
      const fullTag = buttonMatch[0]!;

      // Strip HTML tags from content to get text
      const textContent = innerContent.replace(/<[^>]+>/g, "").trim();
      const hasAriaLabel = /\baria-label\s*=/i.test(attrs);
      const hasAriaLabelledBy = /\baria-labelledby\s*=/i.test(attrs);
      const hasTitle = /\btitle\s*=/i.test(attrs);

      if (!textContent && !hasAriaLabel && !hasAriaLabelledBy && !hasTitle) {
        findings.push({
          id: `button-empty-${buttonIndex}`,
          title: "Button Without Accessible Name",
          severity: "medium",
          confidence: "certain",
          description:
            "A <button> has no text content or accessible name (aria-label). Screen readers cannot announce its purpose.",
          evidence: {
            type: "dom_element",
            data: fullTag.trim(),
            context: `URL: ${target.url}`,
          },
          recommendation:
            "Add visible text inside the button, or use aria-label to provide an accessible name.",
          element: fullTag,
          url: target.url,
        });
      }

      buttonIndex++;
    }

    return {
      detectionId: this.id,
      category: this.category,
      status: "completed",
      findings,
      score: calculateScore(findings),
      metadata: {
        inputsScanned: inputIndex,
        buttonsScanned: buttonIndex,
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
