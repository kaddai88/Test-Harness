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
        // Try JSON parse first
        try {
          const parsed = JSON.parse(str);
          if (typeof parsed === "object" && parsed !== null) {
            return Object.fromEntries(
              Object.entries(parsed).map(([k, v]) => [k, String(v)])
            );
          }
        } catch {
          // Not JSON, try URL-encoded format
        }

        // Try URL-encoded format: "key1=value1&key2=value2"
        if (str.includes("=") && !str.startsWith("{")) {
          const params = new URLSearchParams(str);
          const result: Record<string, string> = {};
          params.forEach((value, key) => {
            result[key] = value;
          });
          if (Object.keys(result).length > 0) {
            return result;
          }
        }

        throw new Error(
          `Cannot parse data. Expected JSON object or URL-encoded string, got: ${str.slice(0, 100)}`
        );
      }),
    ])
    .describe("Field data as JSON object, JSON string, or URL-encoded string (key1=value1&key2=value2)"),
  submit: z.boolean().optional().describe("Whether to submit the form after filling (default: true)").default(true),
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
