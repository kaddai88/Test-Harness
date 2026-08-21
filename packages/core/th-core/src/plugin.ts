/**
 * Plugin system — the unit of composition.
 *
 * Every capability (LLM adapter, detection module, tool, storage backend)
 * is packaged as a plugin with a manifest, activation, and deactivation lifecycle.
 */
import type { THContainer } from "./container.js";

/** Plugin metadata and contribution declarations */
export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly dependencies?: Record<string, string>;
  readonly contributes?: {
    services?: ServiceContribution[];
    events?: EventContribution[];
  };
}

/** Declares a service this plugin provides */
export interface ServiceContribution {
  definitionId: symbol;
  providerId?: string;
  isDefault?: boolean;
}

/** Declares an event this plugin emits or listens to */
export interface EventContribution {
  eventName: string;
  role: "producer" | "consumer";
}

/**
 * Abstract base class for all plugins.
 *
 * Subclass this to create a plugin:
 * ```ts
 * class SecurityPlugin extends THPlugin {
 *   static manifest: PluginManifest = { name: "...", version: "1.0.0" };
 *   async activate(ctx) { ... register services ... }
 *   async deactivate() { ... cleanup ... }
 * }
 * ```
 */
export abstract class THPlugin {
  /** Called when the plugin is loaded into a container */
  abstract activate(container: THContainer): Promise<void> | void;

  /** Called when the plugin is unloaded — release resources */
  abstract deactivate(): Promise<void> | void;
}
