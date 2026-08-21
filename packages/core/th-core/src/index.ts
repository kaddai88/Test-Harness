/**
 * @test-harness/th-core
 *
 * The plugin framework — Cordis-inspired DI, events, and lifecycle.
 */

// Plugin system
export { THPlugin } from "./plugin.js";
export type { PluginManifest, ServiceContribution, EventContribution } from "./plugin.js";

// Service definitions
export {
  defineService,
  valueProvider,
  factoryProvider,
} from "./service.js";
export type { ServiceDefinition, ServiceProvider } from "./service.js";

// Event bus
export { EventBusImpl } from "./event.js";
export type { Disposable, EventHandler, WaterfallHandler, SerialHandler } from "./event.js";

// DI container
export { THContainer } from "./container.js";

// Effect system
export { EffectStack } from "./effect.js";
export type { Effect } from "./effect.js";

// Plugin loader
export { PluginLoader } from "./loader.js";
