/**
 * LLM Router — selects the best provider based on task requirements.
 */
import type { LLMProvider } from "@test-harness/th-protocol";

/** Task complexity levels for model routing */
export type TaskComplexity = "fast" | "balanced" | "best";

/** Provider registration with metadata */
interface ProviderEntry {
  provider: LLMProvider;
  tier: TaskComplexity;
  costPerToken?: number;
}

/**
 * LLMRouter selects the appropriate LLM provider based on task complexity.
 *
 * - fast: classification, extraction, simple formatting → cheapest model
 * - balanced: finding interpretation, moderate analysis → mid-tier
 * - best: scan planning, report generation → most capable model
 */
export class LLMRouter {
  private providers: ProviderEntry[] = [];
  private defaultProvider?: LLMProvider;

  /** Register a provider at a given tier */
  register(
    provider: LLMProvider,
    tier: TaskComplexity,
    options?: { costPerToken?: number }
  ): void {
    this.providers.push({
      provider,
      tier,
      costPerToken: options?.costPerToken,
    });
    if (!this.defaultProvider) this.defaultProvider = provider;
  }

  /** Set the default provider */
  setDefault(provider: LLMProvider): void {
    this.defaultProvider = provider;
  }

  /** Select a provider for the given complexity */
  route(complexity: TaskComplexity): LLMProvider {
    // Find providers matching the requested tier
    const matching = this.providers.filter((p) => p.tier === complexity);
    if (matching.length > 0) {
      // Pick cheapest if cost info available
      const withCost = matching.filter((p) => p.costPerToken !== undefined);
      if (withCost.length > 0) {
        withCost.sort((a, b) => (a.costPerToken ?? 0) - (b.costPerToken ?? 0));
        return withCost[0]!.provider;
      }
      return matching[0]!.provider;
    }

    // Fallback: tier hierarchy — try next tier down, then default
    const fallback: Record<TaskComplexity, TaskComplexity[]> = {
      fast: ["balanced", "best"],
      balanced: ["best", "fast"],
      best: ["balanced", "fast"],
    };
    for (const alt of fallback[complexity]) {
      const alts = this.providers.filter((p) => p.tier === alt);
      if (alts.length > 0) return alts[0]!.provider;
    }

    if (this.defaultProvider) return this.defaultProvider;
    throw new Error("No LLM providers registered");
  }

  /** Get all registered providers */
  getAll(): LLMProvider[] {
    return this.providers.map((p) => p.provider);
  }

  /** Health check all providers */
  async healthCheckAll(): Promise<
    Array<{ provider: string; healthy: boolean }>
  > {
    const results = await Promise.allSettled(
      this.providers.map(async (p) => ({
        provider: p.provider.name,
        healthy: await p.provider.healthCheck(),
      }))
    );
    return results.map((r) =>
      r.status === "fulfilled"
        ? r.value
        : { provider: "unknown", healthy: false }
    );
  }
}
