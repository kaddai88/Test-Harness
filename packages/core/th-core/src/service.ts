/**
 * Service definition — typed capability contracts.
 *
 * A ServiceDefinition is a symbol-keyed handle that identifies a capability
 * in the DI container. It follows DSH's "capability seam" pattern:
 * Definition → Provider → Consumer.
 */

/** Phantom-typed service definition */
export interface ServiceDefinition<T> {
  readonly id: symbol;
  readonly name: string;
  /** Phantom type tag — not used at runtime */
  readonly _type: T;
}

/**
 * Define a new service type.
 *
 * @example
 * ```ts
 * const LLMProvider = defineService<LLMProvider>("LLMProvider");
 * container.register(LLMProvider, new OllamaProvider());
 * const llm = container.get(LLMProvider);
 * ```
 */
export function defineService<T>(name: string): ServiceDefinition<T> {
  return {
    id: Symbol(name),
    name,
    _type: undefined as unknown as T,
  };
}

/** A provider that supplies a service instance */
export interface ServiceProvider<T> {
  get(): T | Promise<T>;
}

/** Wraps a static value as a ServiceProvider */
export function valueProvider<T>(value: T): ServiceProvider<T> {
  return { get: () => value };
}

/** Wraps a factory function as a ServiceProvider */
export function factoryProvider<T>(
  factory: () => T | Promise<T>
): ServiceProvider<T> {
  return { get: factory };
}
