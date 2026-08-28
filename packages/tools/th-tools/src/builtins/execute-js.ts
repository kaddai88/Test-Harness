/**
 * Built-in tool: execute_js — execute JavaScript in the browser context.
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import type { THContainer } from "@test-harness/th-core";
import { BrowserDriverDefinition, type BrowserDriver } from "@test-harness/th-browser";

const inputSchema = z.object({
  script: z.string().describe("JavaScript code to execute in the browser context"),
  selector: z.string().optional().describe("Optional CSS selector to scope the execution"),
});

const outputSchema = z.object({
  result: z.any(),
  type: z.string(),
});

export function createExecuteJsTool(container: THContainer): Tool {
  return {
    id: "execute_js",
    name: "Execute JavaScript",
    description:
      "Execute JavaScript code in the browser context. Use this for complex interactions like AJAX requests, data encryption, or custom validation. Returns the result of the execution.",
    category: "browser",
    inputSchema,
    outputSchema,
    timeoutMs: 30_000,

    isConcurrencySafe: () => false,

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const { script, selector } = inputSchema.parse(input);
      const browser = container.get(BrowserDriverDefinition) as BrowserDriver;
      const start = Date.now();

      try {
        let result: any;

        if (selector) {
          // Execute in the context of a specific element
          result = await browser.evaluate(`
            (function() {
              const el = document.querySelector("${selector.replace(/"/g, '\\"')}");
              if (!el) return { error: "Element not found" };
              ${script}
            })()
          `);
        } else {
          // Execute in the page context
          result = await browser.evaluate(`
            (function() {
              ${script}
            })()
          `);
        }

        const type = typeof result;
        let serializableResult: any;

        // Handle different result types
        if (type === 'undefined') {
          serializableResult = null;
        } else if (type === 'function') {
          serializableResult = "[Function]";
        } else if (result && typeof result === 'object' && result.tagName) {
          serializableResult = {
            type: "Element",
            tagName: result.tagName,
            text: result.textContent?.slice(0, 200),
          };
        } else if (Array.isArray(result) && result[0]?.tagName) {
          serializableResult = result.map(el => ({
            tagName: el.tagName,
            text: el.textContent?.slice(0, 100),
          }));
        } else {
          // Try to serialize, fallback to string
          try {
            JSON.stringify(result);
            serializableResult = result;
          } catch {
            serializableResult = String(result);
          }
        }

        return {
          success: true,
          data: {
            result: serializableResult,
            type,
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
