/**
 * Built-in tool: observe — observe the current page state.
 * Returns visible text, elements, and structure without taking a screenshot.
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import type { THContainer } from "@test-harness/th-core";
import { BrowserDriverDefinition, type BrowserDriver } from "@test-harness/th-browser";

const inputSchema = z.object({
  selector: z.string().optional().describe("CSS selector to observe (defaults to entire page)"),
});

export function createObserveTool(container: THContainer): Tool {
  return {
    id: "observe",
    name: "Observe Page",
    description:
      "Observe the current page state — visible text, links, buttons, forms, and structure. Use this to understand what's on the page before taking action.",
    category: "browser",
    inputSchema,
    outputSchema: z.any(),
    timeoutMs: 15_000,

    isConcurrencySafe: () => true,

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const { selector } = inputSchema.parse(input);
      const browser = container.get(BrowserDriverDefinition) as BrowserDriver;
      const start = Date.now();

      try {
        // Get page info
        const pageInfo = await browser.getPageInfo();

        // Get visible links
        const links = await browser.getLinks();

        // Get page features
        const features = await browser.discoverFeatures();

        // Build observation summary
        const observation = {
          url: pageInfo.url,
          title: pageInfo.title,
          // Extract key visible text from HTML (first 2000 chars)
          contentPreview: pageInfo.html.replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 2000),
          links: links.slice(0, 20).map(l => ({
            text: l.text.slice(0, 50),
            href: l.href,
          })),
          forms: features.filter(f => f.type === 'form').map(f => ({
            selector: f.selector,
            action: f.action,
            fieldCount: f.fields?.length ?? 0,
          })),
          buttons: features.filter(f => f.type === 'button').map(f => ({
            label: f.label,
            selector: f.selector,
          })),
          inputs: features.filter(f => f.type === 'input').map(f => ({
            label: f.label,
            selector: f.selector,
          })),
        };

        return {
          success: true,
          data: observation,
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
