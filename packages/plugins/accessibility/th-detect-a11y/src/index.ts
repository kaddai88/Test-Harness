/**
 * @test-harness/th-detect-a11y
 *
 * Accessibility detection plugin — image, form, and heading checks.
 */
import { THPlugin, type THContainer } from "@test-harness/th-core";
import { DetectionServiceDefinition } from "@test-harness/th-detection";
import { valueProvider } from "@test-harness/th-core";
import { ImageAccessibilityDetector } from "./image-a11y.js";
import { FormAccessibilityDetector } from "./form-a11y.js";
import { HeadingAccessibilityDetector } from "./heading-a11y.js";

export { ImageAccessibilityDetector } from "./image-a11y.js";
export { FormAccessibilityDetector } from "./form-a11y.js";
export { HeadingAccessibilityDetector } from "./heading-a11y.js";

/** Plugin that registers accessibility detection modules */
export class A11yDetectionPlugin extends THPlugin {
  static manifest = {
    name: "@test-harness/th-detect-a11y",
    version: "0.1.0",
    description: "Accessibility detection plugin (images, forms, headings)",
  };

  override activate(container: THContainer): void {
    container.register(
      DetectionServiceDefinition,
      valueProvider(new ImageAccessibilityDetector()),
      { id: "a11y-images" }
    );
    container.register(
      DetectionServiceDefinition,
      valueProvider(new FormAccessibilityDetector()),
      { id: "a11y-forms" }
    );
    container.register(
      DetectionServiceDefinition,
      valueProvider(new HeadingAccessibilityDetector()),
      { id: "a11y-headings" }
    );
  }

  override deactivate(): void {
    // Nothing to clean up
  }
}
