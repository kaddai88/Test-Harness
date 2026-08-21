/**
 * DI Container — the service registry.
 *
 * The container manages service definitions → provider mappings.
 * It supports:
 * - Multi-provider services (by id)
 * - Default provider selection
 * - Child containers with scoped overrides
 * - Effect-tracked disposal
 */
import type { ServiceDefinition, ServiceProvider } from "./service.js";
import { EffectStack } from "./effect.js";
import { EventBusImpl } from "./event.js";

/** Registration entry */
interface Registration<T> {
  definition: ServiceDefinition<T>;
  provider: ServiceProvider<T>;
  id: string;
  isDefault: boolean;
  cached?: T;
}

/**
 * THContainer — dependency injection container with effect tracking.
 *
 * Every service registration is tracked as an effect and unwound on dispose.
 */
export class THContainer {
  private registrations = new Map<symbol, Registration<unknown>[]>();
  private effects = new EffectStack();
  private readonly eventBus: EventBusImpl;
  private readonly parent?: THContainer;
  private children: THContainer[] = [];
  private disposed = false;

  constructor(parent?: THContainer) {
    this.parent = parent;
    this.eventBus = parent
      ? new EventBusImpl(parent.getEventBus() as EventBusImpl)
      : new EventBusImpl();
    this.effects.track("event-bus", () => this.eventBus.clear());
  }

  /** Register a service provider */
  register<T>(
    definition: ServiceDefinition<T>,
    provider: ServiceProvider<T>,
    options?: { id?: string; isDefault?: boolean }
  ): void {
    this.ensureNotDisposed();
    const id = options?.id ?? "default";
    const isDefault = options?.isDefault ?? true;

    const regs = this.registrations.get(definition.id) ?? [];

    // If this is marked default, un-default the others
    if (isDefault) {
      for (const r of regs) r.isDefault = false;
    }

    const registration: Registration<unknown> = {
      definition: definition as ServiceDefinition<unknown>,
      provider: provider as ServiceProvider<unknown>,
      id,
      isDefault,
    };
    regs.push(registration);
    this.registrations.set(definition.id, regs);

    this.effects.track(`service:${definition.name}:${id}`, () => {
      const current = this.registrations.get(definition.id);
      if (current) {
        const idx = current.indexOf(registration);
        if (idx >= 0) current.splice(idx, 1);
        if (current.length === 0) this.registrations.delete(definition.id);
      }
    });
  }

  /** Get a service by definition — returns the default or first provider */
  get<T>(definition: ServiceDefinition<T>, id?: string): T {
    this.ensureNotDisposed();

    // Check own registrations first
    const own = this.resolve<T>(definition, id);
    if (own !== undefined) return own;

    // Delegate to parent
    if (this.parent) return this.parent.get(definition, id);

    throw new Error(
      `Service "${definition.name}" not found` +
        (id ? ` (id: "${id}")` : "")
    );
  }

  /** Get all providers for a service definition */
  getAll<T>(definition: ServiceDefinition<T>): T[] {
    this.ensureNotDisposed();
    const results: T[] = [];

    // Parent registrations first (overridable by child)
    if (this.parent) {
      results.push(...this.parent.getAll(definition));
    }

    const regs = this.registrations.get(definition.id) ?? [];
    for (const reg of regs) {
      const r = reg as Registration<T>;
      if (!r.cached) {
        r.cached = r.provider.get() as T;
      }
      results.push(r.cached);
    }

    return results;
  }

  /** Check if a service is registered (own or parent) */
  has(definition: ServiceDefinition<unknown>, id?: string): boolean {
    const regs = this.registrations.get(definition.id) ?? [];
    if (id) return regs.some((r) => r.id === id);
    if (regs.length > 0) return true;
    return this.parent?.has(definition, id) ?? false;
  }

  /** Get the event bus */
  get events(): EventBusImpl {
    return this.eventBus;
  }

  /** Get the raw event bus (for child container chaining) */
  getEventBus(): EventBusImpl {
    return this.eventBus;
  }

  /** Track an effect in this container */
  effect(label: string, dispose: () => Promise<void> | void): void {
    this.effects.track(label, dispose);
  }

  /** Create a child container scoped to this one */
  createChild(): THContainer {
    this.ensureNotDisposed();
    const child = new THContainer(this);
    this.children.push(child);
    this.effects.track("child-container", async () => {
      await child.dispose();
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
    });
    return child;
  }

  /** Dispose this container and all children, unwinding effects in reverse */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    // Dispose children first
    for (const child of [...this.children]) {
      await child.dispose();
    }
    this.children = [];

    await this.effects.dispose();
  }

  private resolve<T>(
    definition: ServiceDefinition<T>,
    id?: string
  ): T | undefined {
    const regs = this.registrations.get(definition.id) ?? [];
    if (regs.length === 0) return undefined;

    if (id) {
      const reg = regs.find((r) => r.id === id) as
        | Registration<T>
        | undefined;
      if (!reg) return undefined;
      if (!reg.cached) reg.cached = reg.provider.get() as T;
      return reg.cached;
    }

    // Return the default provider, or the last registered
    const defaultReg =
      (regs.find((r) => r.isDefault) as Registration<T> | undefined) ??
      (regs[regs.length - 1] as Registration<T> | undefined);
    if (!defaultReg) return undefined;
    if (!defaultReg.cached)
      defaultReg.cached = defaultReg.provider.get() as T;
    return defaultReg.cached;
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error("Container already disposed");
    }
  }
}
