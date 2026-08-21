/**
 * @test-harness/th-llm-openai
 *
 * OpenAI LLM adapter — cloud provider.
 */
import { THPlugin, type THContainer } from "@test-harness/th-core";
import { valueProvider } from "@test-harness/th-core";
import { LLMProviderService } from "@test-harness/th-llm";
import {
  OpenAIProvider,
  type OpenAIProviderConfig,
} from "./openai-provider.js";

export { OpenAIProvider } from "./openai-provider.js";
export type { OpenAIProviderConfig } from "./openai-provider.js";

/** Plugin that registers the OpenAI LLM provider */
export class OpenAIPlugin extends THPlugin {
  static manifest = {
    name: "@test-harness/th-llm-openai",
    version: "0.1.0",
    description: "OpenAI cloud LLM provider",
  };

  private provider?: OpenAIProvider;

  constructor(private readonly config?: OpenAIProviderConfig) {
    super();
  }

  override activate(container: THContainer): void {
    this.provider = new OpenAIProvider(this.config);
    container.register(
      LLMProviderService,
      valueProvider(this.provider),
      { id: "openai" }
    );
  }

  override deactivate(): void {
    this.provider = undefined;
  }
}
