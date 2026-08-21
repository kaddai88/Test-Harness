/**
 * Plugin loader — loads and activates plugins into a container.
 */
import type { THPlugin } from "./plugin.js";
import type { THContainer } from "./container.js";

/** Tracks loaded plugins for orderly deactivation */
export class PluginLoader {
  private loaded: Array<{ plugin: THPlugin; container: THContainer }> = [];

  /** Load and activate a plugin */
  async load(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    PluginClass: new (...args: any[]) => THPlugin,
    container: THContainer
  ): Promise<void> {
    const plugin = new PluginClass();
    await plugin.activate(container);
    this.loaded.push({ plugin, container });
  }

  /** Deactivate all loaded plugins in reverse order */
  async unloadAll(): Promise<void> {
    const errors: Error[] = [];
    for (const { plugin } of [...this.loaded].reverse()) {
      try {
        await plugin.deactivate();
      } catch (err) {
        errors.push(
          err instanceof Error ? err : new Error(String(err))
        );
      }
    }
    this.loaded = [];
    if (errors.length > 0) {
      throw new Error(
        `Plugin unload errors: ${errors.map((e) => e.message).join("; ")}`
      );
    }
  }

  get loadedCount(): number {
    return this.loaded.length;
  }
}
