/**
 * @test-harness/th-crawl
 *
 * Web crawling infrastructure — HTTP fetch, DOM extraction, link discovery.
 */
import { THPlugin, type THContainer, valueProvider } from "@test-harness/th-core";
import {
  CrawlServiceDefinition,
  CrawlServiceImpl,
} from "./service.js";

export { CrawlServiceDefinition, CrawlServiceImpl } from "./service.js";
export { HttpFetcher } from "./fetcher/http-fetcher.js";
export { DOMExtractor } from "./extractor/dom-extractor.js";
export { LinkExtractor } from "./extractor/link-extractor.js";
export { RobotsParser } from "./crawler/robots.js";
export type { RobotsPolicy } from "./crawler/robots.js";

/** Plugin that registers the CrawlService */
export class CrawlPlugin extends THPlugin {
  static manifest = {
    name: "@test-harness/th-crawl",
    version: "0.1.0",
    description: "Web crawling infrastructure",
  };

  override activate(container: THContainer): void {
    container.register(
      CrawlServiceDefinition,
      valueProvider(new CrawlServiceImpl())
    );
  }

  override deactivate(): void {
    // Nothing to clean up
  }
}
