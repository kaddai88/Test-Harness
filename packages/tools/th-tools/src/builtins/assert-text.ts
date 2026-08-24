/**
 * Built-in tool: assert_text — assert that an element contains specific text.
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import type { THContainer } from "@test-harness/th-core";
import { BrowserDriverDefinition, type BrowserDriver } from "@test-harness/th-browser";

const inputSchema = z.object({
  selector: z.string().describe("CSS selector of the element to check"),
  expectedText: z.string().describe("Text the element should contain"),
  caseSensitive: z.boolean().optional().describe("Case-sensitive match (default: false)"),
  timeout: z.number().optional().describe("Timeout in ms waiting for element"),
});

const outputSchema = z.object({
  matches: z.boolean(),
  actualText: z.string(),
  selector: z.string(),
  expectedText: z.string(),
});

export function createAssertTextTool(container: THContainer): Tool {
  return {
    id: "assert_text",
    name: "Assert Element Text",
    description:
      "Assert that an element contains specific text. Returns whether the text matches and the actual text content.",
    category: "analysis",
    inputSchema,
    outputSchema,
    timeoutMs: 15_000,

    // Browser is a shared resource — not safe for concurrent tool use
    isConcurrencySafe: () => false,

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const { selector, expectedText, caseSensitive, timeout } = inputSchema.parse(input);
      const browser = container.get(BrowserDriverDefinition) as BrowserDriver;
      const start = Date.now();

      try {
        if (timeout && timeout > 0) {
          await browser.waitForSelector(selector, { timeout });
        }

        const actualText = await browser.getText(selector);
        const matches = caseSensitive
          ? actualText.includes(expectedText)
          : actualText.toLowerCase().includes(expectedText.toLowerCase());

        return {
          success: true,
          data: { matches, actualText, selector, expectedText },
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
