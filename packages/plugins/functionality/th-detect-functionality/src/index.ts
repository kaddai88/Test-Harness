/**
 * @test-harness/th-detect-functionality
 *
 * Functionality detection plugin — form, navigation, and UI checks.
 */
import { THPlugin, type THContainer } from "@test-harness/th-core";
import { DetectionServiceDefinition } from "@test-harness/th-detection";
import { valueProvider } from "@test-harness/th-core";
import { FormInteractionDetector } from "./form-interaction.js";
import { NavigationDetector } from "./navigation.js";
import { UIFunctionalityDetector } from "./ui-functionality.js";

export { FormInteractionDetector } from "./form-interaction.js";
export { NavigationDetector } from "./navigation.js";
export { UIFunctionalityDetector } from "./ui-functionality.js";

/** Plugin that registers functionality detection modules */
export class FunctionalityDetectionPlugin extends THPlugin {
  static manifest = {
    name: "@test-harness/th-detect-functionality",
    version: "0.1.0",
    description: "Functionality detection plugins (forms, navigation, UI)",
  };

  override activate(container: THContainer): void {
    container.register(
      DetectionServiceDefinition,
      valueProvider(new FormInteractionDetector()),
      { id: "form-interaction" }
    );
    container.register(
      DetectionServiceDefinition,
      valueProvider(new NavigationDetector()),
      { id: "navigation" }
    );
    container.register(
      DetectionServiceDefinition,
      valueProvider(new UIFunctionalityDetector()),
      { id: "ui-functionality" }
    );
  }

  override deactivate(): void {
    // Nothing to clean up
  }
}
