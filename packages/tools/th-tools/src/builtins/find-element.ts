/**
 * Built-in tool: find_element — multi-strategy semantic element location.
 *
 * This is the core generalization tool. Instead of relying on CSS selectors
 * (which break when sites change), it uses semantic hints to locate elements:
 *
 *   find_element({ hint: "登录按钮" })
 *   → tries: cache → semantic search → DOM distillation → CSS → XPath
 *   → returns: { selector: "#login-btn", confidence: 0.95, strategy: "cache" }
 *
 * The returned selector can then be used with click_element, fill_form, etc.
 * This is the "self-healing locator" pattern.
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import type { THContainer } from "@test-harness/th-core";
import { BrowserDriverDefinition, type BrowserDriver } from "@test-harness/th-browser";

const inputSchema = z.object({
  hint: z.string().describe(
    'Semantic description of the element to find (e.g., "登录按钮", "search input", "Submit order")'
  ),
  selector: z.string().optional().describe(
    'Optional CSS selector as a fallback hint. Used if semantic search fails.'
  ),
});

export function createFindElementTool(container: THContainer): Tool {
  return {
    id: "find_element",
    name: "Find Element",
    description:
      "Find an element on the page using a semantic description instead of a CSS selector. " +
      "This is the preferred way to locate elements — it works across different websites and " +
      "automatically adapts when the site's layout changes. Returns a CSS selector that can be " +
      "used with click_element, fill_form, etc. " +
      "Examples: hint=\"登录按钮\", hint=\"search input field\", hint=\"Submit order button\"",
    category: "browser",
    inputSchema,
    outputSchema: z.any(),
    timeoutMs: 15_000,
    isConcurrencySafe: () => true,

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const { hint, selector } = inputSchema.parse(input);
      const browser = container.get(BrowserDriverDefinition) as BrowserDriver;
      const start = Date.now();

      try {
        const result = await browser.findElement(hint, selector);

        return {
          success: true,
          data: {
            selector: result.selector,
            xpath: result.xpath,
            strategy: result.strategy,
            confidence: result.confidence,
            hint: result.hint,
            message: `Found "${hint}" via ${result.strategy} (confidence: ${(result.confidence * 100).toFixed(0)}%). ` +
              `Use selector "${result.selector}" with click_element or other tools.`,
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
