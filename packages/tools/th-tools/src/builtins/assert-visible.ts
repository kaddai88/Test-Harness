/**
 * Built-in tool: assert_visible — assert that an element is visible on the page.
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import type { THContainer } from "@test-harness/th-core";
import { BrowserDriverDefinition, type BrowserDriver } from "@test-harness/th-browser";

const inputSchema = z.object({
  selector: z.string().describe("CSS selector of the element to check"),
  timeout: z.number().optional().describe("Timeout in ms waiting for visibility"),
});

const outputSchema = z.object({
  visible: z.boolean(),
  text: z.string(),
  selector: z.string(),
});

export function createAssertVisibleTool(container: THContainer): Tool {
  return {
    id: "assert_visible",
    name: "Assert Element Visible",
    description:
      "Assert that an element identified by a CSS selector is visible on the page. Returns visibility status and the element's text content.",
    category: "analysis",
    inputSchema,
    outputSchema,
    timeoutMs: 15_000,

    // Browser is a shared resource — not safe for concurrent tool use
    isConcurrencySafe: () => false,

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const { selector, timeout } = inputSchema.parse(input);
      const browser = container.get(BrowserDriverDefinition) as BrowserDriver;
      const start = Date.now();

      try {
        // Optionally wait for the element to appear
        if (timeout && timeout > 0) {
          await browser.waitForSelector(selector, { timeout, visible: true });
        }

        const visible = await browser.isVisible(selector);
        let text = "";
        if (visible) {
          text = await browser.getText(selector);
        }

        return {
          success: true,
          data: { visible, text, selector },
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
