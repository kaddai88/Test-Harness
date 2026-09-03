/**
 * Built-in tool: extract_data — extract structured data from the page.
 *
 * Inspired by Stagehand's extract() API. Uses DOM distillation to pull
 * meaningful content from the page, then the agent (LLM) interprets it.
 *
 * This tool returns a distilled view of the page content — not raw HTML,
 * but a structured summary of text, forms, tables, and links that the
 * LLM can reason about.
 *
 * For more targeted extraction, combine with observe_page:
 *   1. observe_page({ filter: "form" }) → find form elements
 *   2. extract_data({}) → get page content
 *   3. LLM interprets the data
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import type { THContainer } from "@test-harness/th-core";
import { BrowserDriverDefinition, type BrowserDriver } from "@test-harness/th-browser";

const inputSchema = z.object({
  includeHtml: z.boolean().optional().describe(
    'Whether to include the full page HTML (default: false). ' +
    'Set to true only if you need the raw DOM for analysis.'
  ),
  includeText: z.boolean().optional().describe(
    'Whether to include the visible text content of the page (default: true).'
  ),
  includeLinks: z.boolean().optional().describe(
    'Whether to include all links on the page (default: true).'
  ),
  includeForms: z.boolean().optional().describe(
    'Whether to include form structure details (default: true).'
  ),
});

export function createExtractDataTool(container: THContainer): Tool {
  return {
    id: "extract_data",
    name: "Extract Data",
    description:
      "Extract structured content from the current page. Returns a clean summary of " +
      "the page including visible text, links, forms, and interactive elements. " +
      "Use this to analyze page content after navigating — it's much more efficient than " +
      "processing raw HTML. For element discovery, use observe_page instead.",
    category: "browser",
    inputSchema,
    outputSchema: z.any(),
    timeoutMs: 15_000,
    isConcurrencySafe: () => true,

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const { includeHtml, includeText, includeLinks, includeForms } = inputSchema.parse(input);
      const browser = container.get(BrowserDriverDefinition) as BrowserDriver;
      const start = Date.now();

      try {
        const pageInfo = await browser.getPageInfo();
        const data: Record<string, unknown> = {
          url: pageInfo.url,
          title: pageInfo.title,
          status: pageInfo.status,
        };

        // Distilled interactive elements (always include for context)
        try {
          const distilled = await browser.distillDom();
          data.interactiveElements = distilled.elementCount;
          data.structure = distilled.structure;
          data.elements = distilled.elements.map(el => ({
            ref: el.ref,
            role: el.role,
            text: el.text.slice(0, 80),
            name: el.name,
            selector: el.selector,
          }));
        } catch {
          data.interactiveElements = 0;
        }

        // Visible text content
        if (includeText !== false) {
          try {
            const text = await browser.evaluate<string>(
              `() => document.body.innerText.slice(0, 10000)`
            );
            data.pageText = text;
          } catch {
            data.pageText = '';
          }
        }

        // Links
        if (includeLinks !== false) {
          try {
            const links = await browser.getLinks();
            data.links = links.slice(0, 100).map(l => ({
              text: l.text.slice(0, 80),
              href: l.href,
            }));
          } catch {
            data.links = [];
          }
        }

        // Full HTML (only if requested)
        if (includeHtml) {
          data.html = pageInfo.html.slice(0, 50000);
        }

        return {
          success: true,
          data,
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
