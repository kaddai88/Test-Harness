/**
 * @test-harness/th-llm-deepseek
 *
 * DeepSeek LLM adapter — cloud provider.
 */
import { THPlugin, type THContainer } from "@test-harness/th-core";
import { valueProvider } from "@test-harness/th-core";
import { LLMProviderService } from "@test-harness/th-llm";
import {
  DeepSeekProvider,
  type DeepSeekProviderConfig,
} from "./deepseek-provider.js";

export { DeepSeekProvider } from "./deepseek-provider.js";
export type { DeepSeekProviderConfig } from "./deepseek-provider.js";

/** Plugin that registers the DeepSeek LLM provider */
export class DeepSeekPlugin extends THPlugin {
  static manifest = {
    name: "@test-harness/th-llm-deepseek",
    version: "0.1.0",
    description: "DeepSeek cloud LLM provider",
  };

  private provider?: DeepSeekProvider;

  constructor(private readonly config?: DeepSeekProviderConfig) {
    super();
  }

  override activate(container: THContainer): void {
    this.provider = new DeepSeekProvider(this.config);
    container.register(
      LLMProviderService,
      valueProvider(this.provider),
      { id: "deepseek" }
    );
  }

  override deactivate(): void {
    this.provider = undefined;
  }
}
