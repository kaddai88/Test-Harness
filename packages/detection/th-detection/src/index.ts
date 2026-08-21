/**
 * @test-harness/th-detection
 *
 * Detection plugin framework — registry, runner, composer, scoring.
 */
import { THPlugin, type THContainer } from "@test-harness/th-core";
import {
  DetectionServiceDefinition,
  DetectionRegistry,
  DetectionRunner,
  DetectionComposer,
} from "./registry.js";

export {
  DetectionServiceDefinition,
  DetectionRegistry,
  DetectionRunner,
  DetectionComposer,
} from "./registry.js";
export {
  calculateScore,
  calculateOverallScore,
  summarizeFindings,
} from "./scoring.js";

/** Plugin that registers the detection framework */
export class DetectionPlugin2 extends THPlugin {
  static manifest = {
    name: "@test-harness/th-detection",
    version: "0.1.0",
    description: "Detection plugin framework",
  };

  private registry?: DetectionRegistry;

  override activate(_container: THContainer): void {
    this.registry = new DetectionRegistry();
  }

  override deactivate(): void {
    this.registry = undefined;
  }

  getRegistry(): DetectionRegistry | undefined {
    return this.registry;
  }
}
