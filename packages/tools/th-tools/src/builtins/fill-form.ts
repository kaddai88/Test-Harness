/**
 * Built-in tool: fill_form — fill form fields with data.
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import type { THContainer } from "@test-harness/th-core";
import { BrowserDriverDefinition, type BrowserDriver, type FormData as BrowserFormData } from "@test-harness/th-browser";

const inputSchema = z.object({
  formSelector: z.string().describe("CSS selector of the form element"),
  data: z
    .union([
      z.record(z.string()),
      z.string().transform((str) => {
        try {
          const parsed = JSON.parse(str);
          if (typeof parsed === "object" && parsed !== null) {
            return Object.fromEntries(
              Object.entries(parsed).map(([k, v]) => [k, String(v)])
            );
          }
          throw new Error("Parsed value is not an object");
        } catch {
          throw new Error(`Invalid JSON string for data: ${str}`);
        }
      }),
    ])
    .describe("Map of field names/selectors to values. Can be a JSON object or JSON string."),
  submit: z.boolean().optional().describe("Whether to submit the form after filling"),
});

const outputSchema = z.object({
  filled: z.boolean(),
  fieldsFilled: z.number(),
  formSelector: z.string(),
});

export function createFillFormTool(container: THContainer): Tool {
  return {
    id: "fill_form",
    name: "Fill Form",
    description:
      "Fill in form fields with provided data. Use this to test forms, search boxes, login flows, etc. Optionally submit the form after filling.",
    category: "browser",
    inputSchema,
    outputSchema,
    timeoutMs: 20_000,

    // Browser is a shared resource — not safe for concurrent tool use
    isConcurrencySafe: () => false,

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const { formSelector, data, submit } = inputSchema.parse(input);
      const browser = container.get(BrowserDriverDefinition) as BrowserDriver;
      const start = Date.now();

      try {
        const formData: BrowserFormData = data;
        await browser.fillForm(formSelector, formData);

        if (submit) {
          await browser.submitForm(formSelector);
        }

        return {
          success: true,
          data: {
            filled: true,
            fieldsFilled: Object.keys(data).length,
            formSelector,
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
