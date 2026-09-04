/**
 * LLM adapter types — the capability seam for LLM providers.
 */

/** Model capability flags */
export type ModelCapability =
  | "chat"
  | "tool_use"
  | "streaming"
  | "vision"
  | "json_mode"
  | "system_prompt";

/** Message role */
export type MessageRole = "system" | "user" | "assistant" | "tool";

/** A conversation message */
export interface Message {
  role: MessageRole;
  content: string;
  /** Base64 data URLs for vision-capable models (e.g. uploaded images) */
  images?: string[];
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

/** A tool call from the model */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Tool schema for LLM function calling */
export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

/** Parameters for a completion request */
export interface CompletionParams {
  model: string;
  messages: Message[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  responseFormat?: "text" | "json";
  signal?: AbortSignal;
}

/** Model response */
export interface ModelResponse {
  id: string;
  content: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  finishReason: "stop" | "tool_calls" | "length" | "error";
  model: string;
}

/** Token usage counters */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Stream chunk from a streaming completion */
export interface StreamChunk {
  type: "content" | "tool_call" | "usage" | "done";
  data: string | ToolCallDelta | TokenUsage;
}

/** Partial tool call delta in streaming */
export interface ToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  arguments?: string;
}

/**
 * LLMProvider — the service definition for LLM adapters.
 * Every LLM backend (OpenAI, DeepSeek, Ollama) implements this.
 */
export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ModelCapability[];

  /** Non-streaming completion */
  complete(params: CompletionParams): Promise<ModelResponse>;

  /** Streaming completion */
  stream(params: CompletionParams): AsyncIterable<StreamChunk>;

  /** Estimate token count for messages */
  countTokens(
    messages: Message[],
    tools?: ToolSchema[]
  ): Promise<number>;

  /** Health check — is the provider reachable? */
  healthCheck(): Promise<boolean>;
}
