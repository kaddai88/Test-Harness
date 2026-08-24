/**
 * @test-harness/th-browser
 *
 * Browser automation capability seam — Puppeteer-based web page interaction.
 * Enables the Agent Loop to perform real browser operations (click, type, navigate)
 * instead of simple HTTP fetching.
 */

// Service Definition
export { BrowserDriverDefinition } from "./definition.js";

// Types
export type {
  BrowserDriver,
  BrowserLaunchOptions,
  NavigationOptions,
  ElementActionOptions,
  FormData,
  ScreenshotOptions,
  PageInfo,
  PerformanceMetrics,
  ConsoleMessage,
  NetworkRequest,
  DiscoveredFeature,
  ElementInfo,
} from "./types.js";

// Provider
export { PuppeteerBrowserProvider } from "./puppeteer-provider.js";
export type { PuppeteerBrowserProviderConfig } from "./puppeteer-provider.js";
