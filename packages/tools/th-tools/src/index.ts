/**
 * @test-harness/th-tools
 *
 * Tool framework — registration, execution, and built-in tools.
 */
import { THPlugin, type THContainer } from "@test-harness/th-core";
import { ToolRegistry } from "./registry.js";
import { createHttpRequestTool } from "./builtins/http-request.js";
import { createClickElementTool } from "./builtins/click-element.js";
import { createFillFormTool } from "./builtins/fill-form.js";
import { createNavigateToTool } from "./builtins/navigate-to.js";
import { createTakeScreenshotTool } from "./builtins/take-screenshot.js";
import { createMeasurePerformanceTool } from "./builtins/measure-performance.js";
import { createAssertVisibleTool } from "./builtins/assert-visible.js";
import { createAssertTextTool } from "./builtins/assert-text.js";
import { createReportFindingTool } from "./builtins/report-finding.js";
import { BrowserDriverDefinition } from "@test-harness/th-browser";
import type { Tool } from "@test-harness/th-protocol";

export { ToolRegistry } from "./registry.js";
export { createHttpRequestTool } from "./builtins/http-request.js";
export { createClickElementTool } from "./builtins/click-element.js";
export { createFillFormTool } from "./builtins/fill-form.js";
export { createNavigateToTool } from "./builtins/navigate-to.js";
export { createTakeScreenshotTool } from "./builtins/take-screenshot.js";
export { createMeasurePerformanceTool } from "./builtins/measure-performance.js";
export { createAssertVisibleTool } from "./builtins/assert-visible.js";
export { createAssertTextTool } from "./builtins/assert-text.js";
export { createReportFindingTool } from "./builtins/report-finding.js";

/** Build the full set of built-in tools for a container. */
export function createAllTools(container: THContainer): Tool[] {
  const tools: Tool[] = [
    createHttpRequestTool(),
  ];

  // Register browser tools only if BrowserDriver is available in container
  try {
    container.get(BrowserDriverDefinition);
    tools.push(
      createClickElementTool(container),
      createFillFormTool(container),
      createNavigateToTool(container),
      createTakeScreenshotTool(container),
      createMeasurePerformanceTool(container),
      createAssertVisibleTool(container),
      createAssertTextTool(container),
    );
  } catch {
    // BrowserDriver not available — skip browser tools
  }

  return tools;
}

/** Plugin that registers the tool framework and built-in tools */
export class ToolsPlugin extends THPlugin {
  static manifest = {
    name: "@test-harness/th-tools",
    version: "0.1.0",
    description: "Tool framework and built-in tools",
  };

  private registry?: ToolRegistry;

  constructor() {
    super();
  }

  override activate(container: THContainer): void {
    this.registry = new ToolRegistry();

    // Register built-in tools
    for (const tool of createAllTools(container)) {
      this.registry.register(tool);
    }
  }

  override deactivate(): void {
    this.registry = undefined;
  }

  getRegistry(): ToolRegistry | undefined {
    return this.registry;
  }
}
