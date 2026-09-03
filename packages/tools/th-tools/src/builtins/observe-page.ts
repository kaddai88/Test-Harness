/**
 * Built-in tool: observe_page — discover actionable elements on the page.
 *
 * Inspired by Stagehand's observe() API. This tool distills the page DOM
 * to an LLM-consumable summary of interactive elements, enabling the agent
 * to understand "what's on the page" without processing the full HTML.
 *
 * Usage:
 *   observe_page({}) → returns a numbered list of interactive elements
 *   observe_page({ filter: "form" }) → returns only form-related elements
 *
 * The returned element refs (@e1, @e2...) can be used with find_element
 * or directly with click/type tools via their selectors.
 */
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";
import type { THContainer } from "@test-harness/th-core";
import { BrowserDriverDefinition, type BrowserDriver, type DistilledElement } from "@test-harness/th-browser";
// formatDistilledForLLM will be available after th-browser rebuild
// For now, inline a simple formatter
function formatSummary(page: { url: string; title: string; elements: DistilledElement[]; elementCount: number; structure: any }): string {
  const lines: string[] = [];
  lines.push(`Page: ${page.title}`);
  lines.push(`URL: ${page.url}`);
  lines.push(`Interactive elements: ${page.elementCount}`);
  if (page.structure.hasForms) lines.push(`Forms: ${page.structure.formCount}`);
  if (page.structure.hasIframes) lines.push(`Iframes: ${page.structure.iframeCount}`);
  lines.push('');
  lines.push('Elements:');
  for (const el of page.elements) {
    const parts = [el.ref];
    parts.push(`[${el.role}]`);
    if (el.text) parts.push(`"${el.text.slice(0, 50)}"`);
    if (el.ariaLabel) parts.push(`aria="${el.ariaLabel}"`);
    if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
    if (el.name) parts.push(`name="${el.name}"`);
    lines.push('  ' + parts.join(' '));
  }
  return lines.join('\n');
}

const inputSchema = z.object({
  filter: z.string().optional().describe(
    'Optional filter to narrow results. E.g., "form", "button", "link", "input". ' +
    'If omitted, returns all interactive elements.'
  ),
  maxElements: z.number().optional().describe(
    'Maximum number of elements to return (default: 50). Use to limit output size.'
  ),
});

export function createObservePageTool(container: THContainer): Tool {
  return {
    id: "observe_page",
    name: "Observe Page",
    description:
      "Discover interactive elements on the current page. Returns a distilled summary of " +
      "buttons, inputs, links, and other interactive elements with semantic descriptions. " +
      "Use this BEFORE interacting with a page to understand what's available. " +
      "This is the generalized alternative to analyzing raw HTML — it works across any website.",
    category: "browser",
    inputSchema,
    outputSchema: z.any(),
    timeoutMs: 15_000,
    isConcurrencySafe: () => true,

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const { filter, maxElements } = inputSchema.parse(input);
      const browser = container.get(BrowserDriverDefinition) as BrowserDriver;
      const start = Date.now();

      try {
        const distilled = await browser.distillDom();
        let elements = distilled.elements;

        // Apply filter
        if (filter) {
          const f = filter.toLowerCase();
          elements = elements.filter((el: DistilledElement) =>
            el.role.includes(f) ||
            el.tag.includes(f) ||
            el.text.toLowerCase().includes(f) ||
            el.ariaLabel.toLowerCase().includes(f) ||
            el.name.toLowerCase().includes(f) ||
            el.placeholder.toLowerCase().includes(f)
          );
        }

        // Apply limit
        const limit = maxElements ?? 50;
        const truncated = elements.length > limit;
        elements = elements.slice(0, limit);

        // Format for LLM
        const summary = formatSummary({
          ...distilled,
          elements,
          elementCount: elements.length,
        });

        return {
          success: true,
          data: {
            summary,
            url: distilled.url,
            title: distilled.title,
            totalElements: distilled.elementCount,
            returnedElements: elements.length,
            truncated,
            structure: distilled.structure,
            elements: elements.map((el: DistilledElement) => ({
              ref: el.ref,
              role: el.role,
              text: el.text.slice(0, 80),
              ariaLabel: el.ariaLabel,
              placeholder: el.placeholder,
              name: el.name,
              selector: el.selector,
            })),
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
