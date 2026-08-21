/**
 * @test-harness/th-detect-seo
 *
 * SEO detection plugin — meta tags, robots.txt, sitemap.
 */
import { THPlugin, type THContainer } from "@test-harness/th-core";
import { DetectionServiceDefinition } from "@test-harness/th-detection";
import { valueProvider } from "@test-harness/th-core";
import { MetaTagsDetector } from "./meta-tags.js";
import { RobotsSitemapDetector } from "./robots-sitemap.js";

export { MetaTagsDetector } from "./meta-tags.js";
export { RobotsSitemapDetector } from "./robots-sitemap.js";

/** Plugin that registers SEO detection modules */
export class SeoDetectionPlugin extends THPlugin {
  static manifest = {
    name: "@test-harness/th-detect-seo",
    version: "0.1.0",
    description: "SEO detection plugin (meta tags, robots, sitemap)",
  };

  override activate(container: THContainer): void {
    container.register(
      DetectionServiceDefinition,
      valueProvider(new MetaTagsDetector()),
      { id: "seo-meta-tags" }
    );
    container.register(
      DetectionServiceDefinition,
      valueProvider(new RobotsSitemapDetector()),
      { id: "robots-sitemap" }
    );
  }

  override deactivate(): void {
    // Nothing to clean up
  }
}
