/**
 * Built-in tool: take_screenshot — capture a screenshot of the current page.
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import type { THContainer } from "@test-harness/th-core";
import { BrowserDriverDefinition, type BrowserDriver } from "@test-harness/th-browser";

const inputSchema = z.object({
  fullPage: z.boolean().optional().describe("Capture full page (default: false)"),
  format: z
    .enum(["png", "jpeg", "webp"])
    .optional()
    .describe("Image format (default: 'png')"),
  quality: z.number().optional().describe("JPEG/WebP quality 0-100"),
  selector: z.string().optional().describe("Screenshot a specific element instead of the page"),
});

const outputSchema = z.object({
  base64: z.string(),
  format: z.string(),
  size: z.number(),
});

export function createTakeScreenshotTool(container: THContainer): Tool {
  return {
    id: "take_screenshot",
    name: "Take Screenshot",
    description:
      "Capture a screenshot of the current page or a specific element. Returns the image as base64. Use this to visually verify page layout, element appearance, or error states.",
    category: "browser",
    inputSchema,
    outputSchema,
    timeoutMs: 15_000,

    // Browser is a shared resource — not safe for concurrent tool use
    isConcurrencySafe: () => false,

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const { fullPage, format, quality, selector } = inputSchema.parse(input);
      const browser = container.get(BrowserDriverDefinition) as BrowserDriver;
      const start = Date.now();

      try {
        const buffer = await browser.screenshot({
          fullPage: fullPage ?? false,
          format: format ?? "png",
          quality,
          selector,
        });

        return {
          success: true,
          data: {
            base64: buffer.toString("base64"),
            format: format ?? "png",
            size: buffer.length,
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
