/**
 * Ollama LLM Provider — adapter for local Ollama models.
 *
 * Communicates with the Ollama REST API (http://localhost:11434 by default).
 * Supports tool calling via the OpenAI-compatible /api/chat endpoint.
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

export interface OllamaProviderConfig {
  /** Ollama base URL (default: http://localhost:11434) */
  baseUrl?: string;
  /** Default model name (e.g., "llama3.1", "qwen2.5") */
  defaultModel?: string;
  /** Request timeout in ms (default: 120000) */
  timeout?: number;
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  tools?: OllamaTool[];
  stream: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
    stop?: string[];
  };
}

interface OllamaMessage {
  role: string;
  content: string;
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, unknown> };
  }>;
}

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaChatResponse {
  model: string;
  message: OllamaMessage;
  done: boolean;
  total_duration?: number;
  eval_count?: number;
  prompt_eval_count?: number;
}

export class OllamaProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ModelCapability[];
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeout: number;

  constructor(config?: OllamaProviderConfig) {
    this.id = "ollama";
    this.name = "Ollama";
    this.baseUrl = config?.baseUrl ?? "http://localhost:11434";
    this.defaultModel = config?.defaultModel ?? "llama3.1";
    this.timeout = config?.timeout ?? 120_000;
    this.capabilities = [
      "chat",
      "tool_use",
      "streaming",
      "system_prompt",
    ];
  }

  async complete(params: CompletionParams): Promise<ModelResponse> {
    const body: OllamaChatRequest = {
      model: params.model || this.defaultModel,
      messages: this.convertMessages(params.messages),
      stream: false,
      options: {
        temperature: params.temperature,
        num_predict: params.maxTokens,
        stop: params.stop,
      },
    };

    if (params.tools && params.tools.length > 0) {
      body.tools = this.convertTools(params.tools);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.timeout
    );
    if (params.signal) {
      params.signal.addEventListener("abort", () =>
        controller.abort()
      );
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Ollama API error ${response.status}: ${text}`
        );
      }

      const data = (await response.json()) as OllamaChatResponse;
      return this.parseResponse(data);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async *stream(
    params: CompletionParams
  ): AsyncIterable<StreamChunk> {
    const body: OllamaChatRequest = {
      model: params.model || this.defaultModel,
      messages: this.convertMessages(params.messages),
      stream: true,
      options: {
        temperature: params.temperature,
        num_predict: params.maxTokens,
      },
    };

    if (params.tools && params.tools.length > 0) {
      body.tools = this.convertTools(params.tools);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.timeout
    );
    if (params.signal) {
      params.signal.addEventListener("abort", () =>
        controller.abort()
      );
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama streaming error: ${response.status}`);
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
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line) as OllamaChatResponse;

            // Stream text content
            if (data.message.content) {
              yield {
                type: "content",
                data: data.message.content,
              };
            }

            // Stream tool calls
            if (data.message.tool_calls) {
              for (const [i, tc] of data.message.tool_calls.entries()) {
                yield {
                  type: "tool_call",
                  data: {
                    index: i,
                    id: `call_${i}`,
                    name: tc.function.name,
                    arguments: JSON.stringify(tc.function.arguments),
                  },
                };
              }
            }

            if (data.done) {
              const usage: TokenUsage = {
                promptTokens: data.prompt_eval_count ?? 0,
                completionTokens: data.eval_count ?? 0,
                totalTokens:
                  (data.prompt_eval_count ?? 0) +
                  (data.eval_count ?? 0),
              };
              yield { type: "usage", data: usage };
              yield { type: "done", data: "" };
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
    // Rough estimation: ~4 chars per token
    const totalChars = messages.reduce(
      (sum, m) => sum + m.content.length,
      0
    );
    return Math.ceil(totalChars / 4);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private convertMessages(messages: Message[]): OllamaMessage[] {
    return messages.map((m) => {
      const msg: OllamaMessage = {
        role: m.role,
        content: m.content,
      };
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        }));
      }
      return msg;
    });
  }

  private convertTools(tools: ToolSchema[]): OllamaTool[] {
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  private parseResponse(data: OllamaChatResponse): ModelResponse {
    const toolCalls: ToolCall[] = [];
    if (data.message.tool_calls) {
      for (const [i, tc] of data.message.tool_calls.entries()) {
        toolCalls.push({
          id: `call_${i}`,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
    }

    const usage: TokenUsage = {
      promptTokens: data.prompt_eval_count ?? 0,
      completionTokens: data.eval_count ?? 0,
      totalTokens:
        (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
    };

    return {
      id: `ollama_${Date.now()}`,
      content: data.message.content ?? "",
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      model: data.model,
    };
  }
}
