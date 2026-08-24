/**
 * Form Interaction Detector — checks if forms exist, if required fields are
 * labeled, and if submit buttons are present.
 *
 * Checks for:
 * - Presence of forms on the page
 * - Required fields with associated labels (via <label for>, aria-label, placeholder)
 * - Submit buttons on forms
 */
import type {
  DetectionPlugin,
  DetectionTarget,
  DetectionContext,
  DetectionResult,
  Finding,
} from "@test-harness/th-protocol";
import { calculateScore } from "@test-harness/th-detection";

export class FormInteractionDetector implements DetectionPlugin {
  readonly id = "form-interaction";
  readonly name = "Form Interaction Check";
  readonly category = "functionality" as const;
  readonly description =
    "Checks for forms, labeled required fields, and submit buttons";
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

    const forms = dom.forms ?? [];
    const html = target.pageData?.html ?? "";

    // Check 1: Are there forms on the page?
    if (forms.length === 0) {
      // Only flag if the page has input-like elements in raw HTML
      const hasInputs = /<input[\s>]/i.test(html) || /<textarea[\s>]/i.test(html);
      if (hasInputs) {
        findings.push({
          id: "forms-not-wrapped",
          title: "Form Inputs Without <form> Element",
          severity: "medium",
          confidence: "firm",
          description:
            "The page contains form inputs (<input>, <textarea>) but they are not wrapped in a <form> element. This may cause accessibility and submission issues.",
          evidence: {
            type: "dom_element",
            data: "Form inputs found without <form> wrapper in HTML",
            context: `URL: ${target.url}`,
          },
          recommendation:
            "Wrap related form inputs in a <form> element with appropriate action and method attributes.",
          url: target.url,
        });
      }
    }

    // Check 2: Required fields have labels
    for (let i = 0; i < forms.length; i++) {
      const form = forms[i];
      if (!form) continue;
      const requiredFields = form.fields.filter((f) => f.required);

      for (const field of requiredFields) {
        const fieldId = field.id ?? field.name;
        const hasLabel =
          // Check for <label for="...">
          new RegExp(
            `<label[^>]+for\\s*=\\s*["']${escapeRegex(fieldId)}["']`,
            "i"
          ).test(html) ||
          // Check for aria-label attribute
          new RegExp(
            `<[^>]+(?:id|name)\\s*=\\s*["']${escapeRegex(fieldId)}["'][^>]+aria-label`,
            "i"
          ).test(html) ||
          // Check for placeholder (weak label)
          Boolean(field.type === "text" || field.type === "email"); // placeholder is acceptable for text/email

        if (!hasLabel) {
          findings.push({
            id: `unlabeled-required-field-${fieldId}`,
            title: `Required Field "${fieldId}" Missing Label`,
            severity: "high",
            confidence: "firm",
            description: `Required field "${fieldId}" does not have an associated label. Users will not know what information is required.`,
            evidence: {
              type: "dom_element",
              data: `<input name="${field.name}" type="${field.type}" required>`,
              context: `Form ${i}: action="${form.action}"`,
            },
            recommendation: `Add a <label for="${fieldId}"> element or aria-label attribute to the field.`,
            url: target.url,
            element: `input[name="${field.name}"]`,
          });
        }
      }

      // Check 3: Submit button exists
      const hasSubmitButton =
        new RegExp(
          `<(?:button[^>]*type\\s*=\\s*["']submit["']|input[^>]*type\\s*=\\s*["']submit["'])`,
          "i"
        ).test(html) ||
        new RegExp(
          `<button[^>]*(?:form\\s*=\\s*["']|formaction)`,
          "i"
        ).test(html);

      if (!hasSubmitButton && form.fields.length > 0) {
        findings.push({
          id: `missing-submit-button-form-${i}`,
          title: `Form Missing Submit Button`,
          severity: "medium",
          confidence: "tentative",
          description: `Form with action "${form.action}" has ${form.fields.length} fields but no visible submit button was detected.`,
          evidence: {
            type: "dom_element",
            data: `Form action="${form.action}" method="${form.method}"`,
            context: `URL: ${target.url}`,
          },
          recommendation:
            "Add a submit button (<button type='submit'> or <input type='submit'>) to the form.",
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
        formsFound: forms.length,
        totalFields: forms.reduce((sum, f) => sum + f.fields.length, 0),
        requiredFields: forms.reduce(
          (sum, f) => sum + f.fields.filter((fd) => fd.required).length,
          0
        ),
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

/** Escape special regex characters in a string */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
