/**
 * Detection service definition + registry.
 */
import { defineService } from "@test-harness/th-core";
import type {
  DetectionPlugin,
  DetectionCategory,
  DetectionTarget,
  DetectionContext,
  DetectionResult,
} from "@test-harness/th-protocol";

export const DetectionServiceDefinition =
  defineService<DetectionPlugin>("DetectionPlugin");

/**
 * DetectionRegistry — manages detection plugin registration and lookup.
 *
 * Supports lookup by id, category, or listing all.
 */
export class DetectionRegistry {
  private detections = new Map<string, DetectionPlugin>();

  /** Register a detection plugin */
  register(plugin: DetectionPlugin): void {
    if (this.detections.has(plugin.id)) {
      throw new Error(
        `Detection plugin "${plugin.id}" already registered`
      );
    }
    this.detections.set(plugin.id, plugin);
  }

  /** Get a detection plugin by id */
  get(id: string): DetectionPlugin | undefined {
    return this.detections.get(id);
  }

  /** Get all registered plugins */
  getAll(): DetectionPlugin[] {
    return [...this.detections.values()];
  }

  /** Get plugins by category */
  getByCategory(category: DetectionCategory): DetectionPlugin[] {
    return this.getAll().filter((p) => p.category === category);
  }

  /** List available detection IDs */
  listIds(): string[] {
    return [...this.detections.keys()];
  }

  /** Check if a detection is registered */
  has(id: string): boolean {
    return this.detections.has(id);
  }

  get size(): number {
    return this.detections.size;
  }
}

/**
 * DetectionRunner — executes a single detection plugin with timeout/error handling.
 */
export class DetectionRunner {
  /** Run a detection plugin against a target */
  async run(
    plugin: DetectionPlugin,
    target: DetectionTarget,
    context: DetectionContext
  ): Promise<DetectionResult> {
    const startedAt = new Date();

    // Check if the plugin can execute against this target
    const canRun = await plugin.canExecute(target, context);
    if (!canRun) {
      return {
        detectionId: plugin.id,
        category: plugin.category,
        status: "skipped",
        findings: [],
        score: 100,
        metadata: { reason: "Target not applicable" },
        startedAt,
        completedAt: new Date(),
      };
    }

    try {
      const result = await plugin.execute(target, context);
      return {
        ...result,
        startedAt,
        completedAt: new Date(),
      };
    } catch (err) {
      return {
        detectionId: plugin.id,
        category: plugin.category,
        status: "failed",
        findings: [],
        score: 0,
        metadata: {},
        startedAt,
        completedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * DetectionComposer — runs multiple detections (serial or parallel).
 */
export class DetectionComposer {
  private registry: DetectionRegistry;
  private runner: DetectionRunner;

  constructor(registry: DetectionRegistry) {
    this.registry = registry;
    this.runner = new DetectionRunner();
  }

  /** Run multiple detections in parallel */
  async runParallel(
    detectionIds: string[],
    target: DetectionTarget,
    context: DetectionContext
  ): Promise<DetectionResult[]> {
    const plugins = detectionIds
      .map((id) => this.registry.get(id))
      .filter((p): p is DetectionPlugin => p !== undefined);

    return Promise.all(
      plugins.map((plugin) => this.runner.run(plugin, target, context))
    );
  }

  /** Run multiple detections in sequence */
  async runSequential(
    detectionIds: string[],
    target: DetectionTarget,
    context: DetectionContext
  ): Promise<DetectionResult[]> {
    const results: DetectionResult[] = [];
    for (const id of detectionIds) {
      const plugin = this.registry.get(id);
      if (!plugin) continue;
      results.push(await this.runner.run(plugin, target, context));
    }
    return results;
  }
}
