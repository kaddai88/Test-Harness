/**
 * @test-harness/th-llm-ollama
 *
 * Ollama LLM adapter — local model provider.
 */
import { THPlugin, type THContainer } from "@test-harness/th-core";
import { valueProvider } from "@test-harness/th-core";
import { LLMProviderService } from "@test-harness/th-llm";
import {
  OllamaProvider,
  type OllamaProviderConfig,
} from "./ollama-provider.js";

export { OllamaProvider } from "./ollama-provider.js";
export type { OllamaProviderConfig } from "./ollama-provider.js";

/** Plugin that registers the Ollama LLM provider */
export class OllamaPlugin extends THPlugin {
  static manifest = {
    name: "@test-harness/th-llm-ollama",
    version: "0.1.0",
    description: "Ollama local LLM provider",
  };

  private provider?: OllamaProvider;

  constructor(private readonly config?: OllamaProviderConfig) {
    super();
  }

  override activate(container: THContainer): void {
    this.provider = new OllamaProvider(this.config);
    container.register(
      LLMProviderService,
      valueProvider(this.provider),
      { id: "ollama" }
    );
  }

  override deactivate(): void {
    this.provider = undefined;
  }
}
