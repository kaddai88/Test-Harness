/**
 * LLM service definition — the capability seam for LLM providers.
 */
import { defineService } from "@test-harness/th-core";
import type { LLMProvider } from "@test-harness/th-protocol";

/** Service definition for LLM providers */
export const LLMProviderService = defineService<LLMProvider>("LLMProvider");
