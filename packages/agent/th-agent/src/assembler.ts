/**
 * Stream Assembler — collects streaming LLM chunks into a complete response.
 *
 * Inspired by DSH's BlockAssembler which accumulates StreamChunk events
 * into a complete assistant message.
 *
 * Usage:
 *   const assembler = new StreamAssembler();
 *   for await (const chunk of llm.stream(params)) {
 *     assembler.push(chunk);
 *     // assembler.partialContent — current text so far
 *   }
 *   const response = assembler.finish();
 */
import type {
  ModelResponse,
  StreamChunk,
  ToolCall,
  TokenUsage,
} from "@test-harness/th-protocol";

export class StreamAssembler {
  private contentParts: string[] = [];
  private toolCallBuffers = new Map<
    number,
    { id?: string; name?: string; arguments: string }
  >();
  private usage: TokenUsage | undefined;
  private finishReason: ModelResponse["finishReason"] = "stop";
  private model = "";
  private _done = false;

  /** Push a streaming chunk into the assembler */
  push(chunk: StreamChunk): void {
    switch (chunk.type) {
      case "content":
        this.contentParts.push(chunk.data as string);
        break;

      case "tool_call": {
        const delta = chunk.data as {
          index: number;
          id?: string;
          name?: string;
          arguments?: string;
        };
        const existing = this.toolCallBuffers.get(delta.index) ?? {
          arguments: "",
        };
        if (delta.id) existing.id = delta.id;
        if (delta.name) existing.name = delta.name;
        if (delta.arguments) existing.arguments += delta.arguments;
        this.toolCallBuffers.set(delta.index, existing);
        break;
      }

      case "usage":
        this.usage = chunk.data as TokenUsage;
        break;

      case "done":
        this._done = true;
        break;
    }
  }

  /** Current partial text content (grows as chunks arrive) */
  get partialContent(): string {
    return this.contentParts.join("");
  }

  /** Whether the stream is complete */
  get done(): boolean {
    return this._done;
  }

  /** Number of tool calls seen so far */
  get toolCallCount(): number {
    return this.toolCallBuffers.size;
  }

  /**
   * Assemble the final ModelResponse from accumulated chunks.
   * Call this after the stream is exhausted.
   */
  finish(modelId?: string): ModelResponse {
    const content = this.contentParts.join("");

    // Assemble tool calls
    const toolCalls: ToolCall[] = [];
    if (this.toolCallBuffers.size > 0) {
      // Sort by index to maintain order
      const sorted = [...this.toolCallBuffers.entries()].sort(
        ([a], [b]) => a - b
      );
      for (const [i, buf] of sorted) {
        let args: Record<string, unknown>;
        try {
          args = buf.arguments ? JSON.parse(buf.arguments) : {};
        } catch {
          args = { _raw: buf.arguments };
        }
        toolCalls.push({
          id: buf.id ?? `call_${i}`,
          name: buf.name ?? "unknown",
          arguments: args,
        });
      }
      this.finishReason = "tool_calls";
    }

    return {
      id: `stream_${Date.now()}`,
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: this.usage ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      finishReason: this.finishReason,
      model: modelId ?? this.model,
    };
  }
}
