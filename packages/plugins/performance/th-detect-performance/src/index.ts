/**
 * @test-harness/th-detect-performance
 *
 * Performance detection plugin — header checks and resource analysis.
 */
import { THPlugin, type THContainer } from "@test-harness/th-core";
import { DetectionServiceDefinition } from "@test-harness/th-detection";
import { valueProvider } from "@test-harness/th-core";
import { PerformanceHeadersDetector } from "./performance-headers.js";
import { ResourceAnalyzer } from "./resource-analyzer.js";

export { PerformanceHeadersDetector } from "./performance-headers.js";
export { ResourceAnalyzer } from "./resource-analyzer.js";

/** Plugin that registers performance detection modules */
export class PerformanceDetectionPlugin extends THPlugin {
  static manifest = {
    name: "@test-harness/th-detect-performance",
    version: "0.1.0",
    description: "Performance detection plugin (headers, resource analysis)",
  };

  override activate(container: THContainer): void {
    container.register(
      DetectionServiceDefinition,
      valueProvider(new PerformanceHeadersDetector()),
      { id: "performance-headers" }
    );
    container.register(
      DetectionServiceDefinition,
      valueProvider(new ResourceAnalyzer()),
      { id: "resource-analyzer" }
    );
  }

  override deactivate(): void {
    // Nothing to clean up
  }
}
