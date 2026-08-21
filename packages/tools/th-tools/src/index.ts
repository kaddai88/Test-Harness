/**
 * @test-harness/th-tools
 *
 * Tool framework — registration, execution, and built-in tools.
 */
import { THPlugin, type THContainer } from "@test-harness/th-core";
import { ToolRegistry } from "./registry.js";
import { createCrawlPageTool } from "./builtins/crawl-page.js";
import { createExtractDomTool } from "./builtins/extract-dom.js";
import { createHttpRequestTool } from "./builtins/http-request.js";
import { createRunDetectionTool } from "./builtins/run-detection.js";
import { createListLinksTool } from "./builtins/list-links.js";
import type { DetectionPlugin } from "@test-harness/th-protocol";

export { ToolRegistry } from "./registry.js";
export { createCrawlPageTool } from "./builtins/crawl-page.js";
export { createExtractDomTool } from "./builtins/extract-dom.js";
export { createHttpRequestTool } from "./builtins/http-request.js";
export { createRunDetectionTool } from "./builtins/run-detection.js";
export { createListLinksTool } from "./builtins/list-links.js";

/** Plugin that registers the tool framework and built-in tools */
export class ToolsPlugin extends THPlugin {
  static manifest = {
    name: "@test-harness/th-tools",
    version: "0.1.0",
    description: "Tool framework and built-in tools",
  };

  private registry?: ToolRegistry;

  constructor(
    private readonly getDetection?: (
      id: string
    ) => DetectionPlugin | undefined
  ) {
    super();
  }

  override activate(container: THContainer): void {
    this.registry = new ToolRegistry();

    // Register built-in tools
    this.registry.register(createCrawlPageTool(container));
    this.registry.register(createExtractDomTool(container));
    this.registry.register(createHttpRequestTool());
    this.registry.register(createListLinksTool(container));

    if (this.getDetection) {
      this.registry.register(
        createRunDetectionTool(container, this.getDetection)
      );
    }
  }

  override deactivate(): void {
    this.registry = undefined;
  }

  getRegistry(): ToolRegistry | undefined {
    return this.registry;
  }
}
