/**
 * Effect system — reversible side effects.
 *
 * Every registration (service, event listener, resource) is tracked as an
 * effect. When a plugin unloads or a container is disposed, effects unwind
 * in reverse order — last registered, first disposed.
 */

export interface Effect {
  readonly label: string;
  dispose(): Promise<void> | void;
}

/**
 * EffectStack tracks effects and unwinds them on dispose.
 *
 * @example
 * ```ts
 * const stack = new EffectStack();
 * stack.track("db-connection", async () => await db.close());
 * stack.track("file-handle", () => fd.close());
 * await stack.dispose(); // unwinds: file-handle → db-connection
 * ```
 */
export class EffectStack {
  private effects: Effect[] = [];
  private disposed = false;

  /** Register a disposable effect */
  track(label: string, dispose: () => Promise<void> | void): void {
    if (this.disposed) {
      throw new Error(
        `Cannot track effect "${label}" — stack already disposed`
      );
    }
    this.effects.push({ label, dispose });
  }

  /** Create a child effect stack that unwinds when this stack unwinds */
  createChild(): EffectStack {
    const child = new EffectStack();
    this.track(`child-stack`, async () => await child.dispose());
    return child;
  }

  /** Unwind all effects in reverse order */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    const errors: Error[] = [];
    // Reverse order: last registered, first disposed
    for (const effect of [...this.effects].reverse()) {
      try {
        await effect.dispose();
      } catch (err) {
        errors.push(
          err instanceof Error
            ? err
            : new Error(`Effect "${effect.label}" threw: ${String(err)}`)
        );
      }
    }
    this.effects = [];

    if (errors.length > 0) {
      const msg = errors.map((e) => e.message).join("; ");
      throw new Error(`Errors during dispose: ${msg}`);
    }
  }

  get size(): number {
    return this.effects.length;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}
