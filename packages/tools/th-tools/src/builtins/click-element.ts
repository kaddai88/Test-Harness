/**
 * Built-in tool: click_element — click an element by CSS selector.
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import type { THContainer } from "@test-harness/th-core";
import { BrowserDriverDefinition, type BrowserDriver } from "@test-harness/th-browser";

const inputSchema = z.object({
  selector: z.string().describe("CSS selector of the element to click"),
  timeout: z.number().optional().describe("Timeout in ms (default: 10000)"),
  waitForVisible: z.boolean().optional().describe("Wait for element to be visible before clicking"),
});

const outputSchema = z.object({
  clicked: z.boolean(),
  selector: z.string(),
});

export function createClickElementTool(container: THContainer): Tool {
  return {
    id: "click_element",
    name: "Click Element",
    description:
      "Click an element on the page identified by a CSS selector. Use this to interact with buttons, links, and other clickable elements in a real browser.",
    category: "browser",
    inputSchema,
    outputSchema,
    timeoutMs: 15_000,

    // Browser is a shared resource — not safe for concurrent tool use
    isConcurrencySafe: () => false,

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const { selector, timeout, waitForVisible } = inputSchema.parse(input);
      const browser = container.get(BrowserDriverDefinition) as BrowserDriver;
      const start = Date.now();

      try {
        await browser.click(selector, {
          selector,
          timeout: timeout ?? 10_000,
          waitForVisible: waitForVisible ?? true,
        });

        return {
          success: true,
          data: { clicked: true, selector },
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
