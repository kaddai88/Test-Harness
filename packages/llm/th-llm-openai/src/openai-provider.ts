/**
 * OpenAI LLM Provider — adapter for the OpenAI chat completions API.
 *
 * Uses the OpenAI-compatible /v1/chat/completions endpoint.
 * Reads API key from OPENAI_API_KEY env var or constructor config.
 * Supports streaming (SSE with "data: {...}") and tool calling.
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

export interface OpenAIProviderConfig {
  /** OpenAI base URL (default: https://api.openai.com/v1) */
  baseUrl?: string;
  /** Default model (default: gpt-4o) */
  defaultModel?: string;
  /** API key (falls back to OPENAI_API_KEY env var) */
  apiKey?: string;
  /** Request timeout in ms (default: 120000) */
  timeout?: number;
}

interface OpenAIMessage {
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

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIChatResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAIMessage;
    finish_reason: "stop" | "length" | "tool_calls" | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
  id: string;
  choices: Array<{
    index: number;
    delta: Partial<OpenAIMessage> & { tool_calls?: Array<{
      index: number;
      id?: string;
      type?: "function";
      function?: { name?: string; arguments?: string };
    }> };
    finish_reason: "stop" | "length" | "tool_calls" | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ModelCapability[];
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor(config?: OpenAIProviderConfig) {
    this.id = "openai";
    this.name = "OpenAI";
    this.defaultModel = config?.defaultModel ?? "gpt-4o";
    this.apiKey = config?.apiKey ?? getEnvVar("OPENAI_API_KEY") ?? "";
    this.timeout = config?.timeout ?? 120_000;
    this.capabilities = [
      "chat",
      "tool_use",
      "streaming",
      "vision",
      "json_mode",
      "system_prompt",
    ];

    // Normalize base URL: remove trailing slash only
    let base = config?.baseUrl ?? "https://api.openai.com/v1";
    this.baseUrl = base.replace(/\/$/, ""); // Remove trailing slash only
  }

  async complete(params: CompletionParams): Promise<ModelResponse> {
    if (!this.apiKey) {
      throw new Error(
        "OpenAI API key not configured. Set OPENAI_API_KEY env var or pass apiKey in config."
      );
    }

    const body = this.buildRequestBody(params, false);

    console.log('[OpenAI] Request URL:', `${this.baseUrl}/chat/completions`);
    console.log('[OpenAI] API Key starts with:', this.apiKey.slice(0, 10));

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
          "X-API-Key": this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      console.log('[OpenAI] Response status:', response.status);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${text}`);
      }

      const data = (await response.json()) as OpenAIChatResponse;
      return this.parseResponse(data);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async *stream(params: CompletionParams): AsyncIterable<StreamChunk> {
    if (!this.apiKey) {
      throw new Error("OpenAI API key not configured");
    }

    const body = this.buildRequestBody(params, true);

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
          "X-API-Key": this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenAI streaming error: ${response.status}`);
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
            const data = JSON.parse(payload) as OpenAIStreamChunk;

            // Stream text content
            const delta = data.choices[0]?.delta;
            if (delta?.content) {
              yield { type: "content", data: delta.content };
            }

            // Stream tool calls
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
    // Rough estimation: ~4 chars per token
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
    const body: Record<string, unknown> = {
      model: params.model || this.defaultModel,
      messages: this.convertMessages(params.messages),
      stream,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stop: params.stop,
    };

    if (params.tools && params.tools.length > 0) {
      body.tools = this.convertTools(params.tools);
    }

    if (params.responseFormat === "json") {
      body.response_format = { type: "json_object" };
    }

    return body;
  }

  private convertMessages(messages: Message[]): OpenAIMessage[] {
    return messages.map((m) => {
      const msg: OpenAIMessage = {
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

  private convertTools(tools: ToolSchema[]): OpenAITool[] {
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  private parseResponse(data: OpenAIChatResponse): ModelResponse {
    const choice = data.choices[0];
    if (!choice) {
      throw new Error("OpenAI returned no choices");
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

    const usage: TokenUsage = {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
    };

    return {
      id: data.id,
      content: choice.message.content ?? "",
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      finishReason:
        choice.finish_reason === "tool_calls"
          ? "tool_calls"
          : choice.finish_reason === "length"
            ? "length"
            : choice.finish_reason === "stop"
              ? "stop"
              : "stop",
      model: data.model,
    };
  }
}

function getEnvVar(name: string): string | undefined {
  try {
    // Node globalThis.process
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process;
    return proc?.env?.[name];
  } catch {
    return undefined;
  }
}
