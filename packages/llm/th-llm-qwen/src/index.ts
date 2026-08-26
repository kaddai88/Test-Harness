/**
 * Qwen LLM Provider — adapter for Alibaba Cloud DashScope Qwen API.
 *
 * Uses the OpenAI-compatible endpoint at DashScope.
 * Reads API key from DASHSCOPE_API_KEY env var or constructor config.
 *
 * Models: qwen-plus, qwen-turbo, qwen-max, qwen-coder-plus, etc.
 * API docs: https://help.aliyun.com/zh/model-studio/developer-reference/use-qwen-by-calling-api
 */
import type {
  LLMProvider,
  CompletionParams,
  ModelResponse,
  StreamChunk,
  Message,
  ToolSchema,
  ToolCall,
  TokenUsage,
  ModelCapability,
} from "@test-harness/th-protocol";

export interface QwenProviderConfig {
  /** DashScope API key (falls back to DASHSCOPE_API_KEY env var) */
  apiKey?: string;
  /** Base URL (falls back to DASHSCOPE_BASE_URL env var or default) */
  baseUrl?: string;
  /** Default model (default: qwen-plus) */
  defaultModel?: string;
  /** Request timeout in ms (default: 120000) */
  timeout?: number;
}

/** Qwen's OpenAI-compatible default base URL */
const QWEN_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

// Reuse the same wire format as OpenAI
interface QwenMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface QwenTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface QwenChatResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: QwenMessage;
    finish_reason: "stop" | "length" | "tool_calls" | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface QwenStreamChunk {
  id: string;
  choices: Array<{
    index: number;
    delta: Partial<QwenMessage> & {
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: "stop" | "length" | "tool_calls" | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function getEnvVar(name: string): string | undefined {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process;
    return proc?.env?.[name];
  } catch {
    return undefined;
  }
}

export class QwenProvider implements LLMProvider {
  readonly id = "qwen";
  readonly name = "Qwen (DashScope)";
  readonly capabilities: ModelCapability[] = [
    "chat",
    "tool_use",
    "streaming",
    "json_mode",
    "system_prompt",
  ];

  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor(config?: QwenProviderConfig) {
    const base = config?.baseUrl ?? getEnvVar("DASHSCOPE_BASE_URL") ?? QWEN_DEFAULT_BASE_URL;
    this.baseUrl = base.replace(/\/+$/, '');  // Remove trailing slashes
    this.defaultModel = config?.defaultModel ?? "qwen-plus";
    this.apiKey = config?.apiKey ?? getEnvVar("DASHSCOPE_API_KEY") ?? "";
    this.timeout = config?.timeout ?? 120_000;
  }

  async complete(params: CompletionParams): Promise<ModelResponse> {
    if (!this.apiKey) {
      throw new Error(
        "Qwen API key not configured. Set DASHSCOPE_API_KEY env var or pass apiKey in config."
      );
    }

    const body = this.buildRequestBody(params, false);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    if (params.signal) {
      params.signal.addEventListener("abort", () => controller.abort());
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        console.error('[Qwen] API error:', response.status, text);
        console.error('[Qwen] Request body:', JSON.stringify(body, null, 2));
        throw new Error(`Qwen API error ${response.status}: ${text}`);
      }

      const data = (await response.json()) as QwenChatResponse;
      return this.parseResponse(data);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async *stream(params: CompletionParams): AsyncIterable<StreamChunk> {
    if (!this.apiKey) {
      throw new Error("Qwen API key not configured");
    }

    const body = this.buildRequestBody(params, true);

    // Debug logging (opt-in via DEBUG=1)
    if (process.env.DEBUG) {
      console.log("[Qwen] Stream request body:", JSON.stringify(body, null, 2));
      console.log("[Qwen] URL:", `${this.baseUrl}/chat/completions`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    if (params.signal) {
      params.signal.addEventListener("abort", () => controller.abort());
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        console.error('[Qwen] Stream error:', response.status, text);
        throw new Error(`Qwen streaming error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            yield { type: "done", data: "" };
            return;
          }

          try {
            const data = JSON.parse(payload) as QwenStreamChunk;

            const delta = data.choices[0]?.delta;
            if (delta?.content) {
              yield { type: "content", data: delta.content };
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                yield {
                  type: "tool_call",
                  data: {
                    index: tc.index,
                    id: tc.id,
                    name: tc.function?.name,
                    arguments: tc.function?.arguments,
                  },
                };
              }
            }

            if (data.usage) {
              const usage: TokenUsage = {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
              };
              yield { type: "usage", data: usage };
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async countTokens(
    messages: Message[],
    _tools?: ToolSchema[]
  ): Promise<number> {
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    return Math.ceil(totalChars / 4);
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private buildRequestBody(
    params: CompletionParams,
    stream: boolean
  ): Record<string, unknown> {
    return {
      model: params.model || this.defaultModel,
      messages: this.convertMessages(params.messages),
      stream,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stop: params.stop,
      ...(params.tools && params.tools.length > 0
        ? { tools: this.convertTools(params.tools) }
        : {}),
      ...(params.responseFormat === "json"
        ? { response_format: { type: "json_object" } }
        : {}),
    };
  }

  private convertMessages(messages: Message[]): QwenMessage[] {
    return messages.map((m) => {
      const msg: QwenMessage = {
        role: m.role,
        content: m.content,
      };
      if (m.name) msg.name = m.name;
      if (m.toolCallId) msg.tool_call_id = m.toolCallId;
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }
      return msg;
    });
  }

  private convertTools(tools: ToolSchema[]): QwenTool[] {
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  private parseResponse(data: QwenChatResponse): ModelResponse {
    const choice = data.choices[0];
    if (!choice) {
      throw new Error("Qwen returned no choices");
    }

    const toolCalls: ToolCall[] = [];
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          // keep empty
        }
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: args,
        });
      }
    }

    return {
      id: data.id,
      content: choice.message.content ?? "",
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      finishReason:
        choice.finish_reason === "tool_calls"
          ? "tool_calls"
          : choice.finish_reason === "length"
            ? "length"
            : "stop",
      model: data.model,
    };
  }
}

/** Plugin that registers the Qwen provider */
import { THPlugin, type THContainer, valueProvider } from "@test-harness/th-core";
import { LLMProviderService } from "@test-harness/th-llm";

export class QwenPlugin extends THPlugin {
  static manifest = {
    name: "@test-harness/th-llm-qwen",
    version: "0.1.0",
    description: "Qwen (DashScope) LLM adapter",
  };

  override activate(container: THContainer): void {
    container.register(
      LLMProviderService,
      valueProvider(new QwenProvider()),
      { id: "qwen", isDefault: false }
    );
  }

  override deactivate(): void {}
}
