# Plugin Development Guide

Test-Harness is built on a **Cordis-inspired** plugin architecture: every
capability (LLM adapter, detection module, tool, storage backend) is packaged
as a plugin and registered behind a typed *service definition*. Plugins are
loaded, activated, and deactivated through a uniform lifecycle.

This guide walks you through:

1. The architecture at a glance
2. Writing a detection plugin (complete example)
3. Writing a tool (complete example)
4. Writing an LLM adapter (complete example)
5. The plugin lifecycle
6. Service definitions and capability seams
7. The event system (`emit`, `waterfall`, `serial`)

---

## 1. Architecture Overview

```
                         ┌──────────────────────────────────┐
                         │        Application (CLI/Server)  │
                         └────────────┬─────────────────────┘
                                      │ loads & activates
                                      ▼
                         ┌──────────────────────────────────┐
                         │     THContainer (DI)             │
                         │       ├─ EventBus                │
                         │       ├─ EffectStack             │
                         │       └─ ServiceRegistry         │
                         └────────────┬─────────────────────┘
                                      │ provides
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
   ┌───────────┐               ┌────────────┐               ┌──────────┐
   │ Detection │               │    LLM     │               │  Tools   │
   │  Plugin   │               │  Provider  │               │  Plugin  │
   └───────────┘               └────────────┘               └──────────┘
         │                            │                            │
         │ registers against          │ implements                 │ registers
         │                            │                            │ against
         ▼                            ▼                            ▼
   DetectionServiceDefinition   LLMServiceDefinition      ToolServiceDefinition
```

Three concepts do all the work:

| Concept | What it is | Where it lives |
|---|---|---|
| **Service Definition** | A symbol-keyed *capability contract*. "LLM provider goes here." | `defineService<T>(name)` in `th-core/service.ts` |
| **Plugin** | A class with `activate(container)` / `deactivate()` that registers providers, listeners, etc. | `THPlugin` in `th-core/plugin.ts` |
| **Event** | A typed pub/sub channel with four dispatch modes | `defineEvent<T>(name)` in `th-protocol/events.ts` |

Everything else — registries, runners, composers — is built on top of these
three primitives.

---

## 2. Detection Plugin (Complete Example)

We'll build a detection that checks whether a site sets the
`X-Frame-Options` header.

### 2.1 Create the package

```bash
packages/detection/th-detect-xframe/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    └── index.test.ts
```

### 2.2 `package.json`

```json
{
  "name": "@test-harness/th-detect-xframe",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "clean": "rm -rf dist",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@test-harness/th-core": "workspace:*",
    "@test-harness/th-protocol": "workspace:*",
    "@test-harness/th-detection": "workspace:*"
  }
}
```

### 2.3 `src/index.ts`

```ts
import type {
  DetectionPlugin,
  DetectionTarget,
  DetectionContext,
  DetectionResult,
  Finding,
} from "@test-harness/th-protocol";

export class XFrameOptionsDetection implements DetectionPlugin {
  readonly id = "x-frame-options";
  readonly name = "X-Frame-Options";
  readonly category = "security";
  readonly description = "Checks that the X-Frame-Options header is set";
  readonly version = "0.1.0";

  async canExecute(target: DetectionTarget, _ctx: DetectionContext): Promise<boolean> {
    // Only runs on HTTP(S) targets
    return /^https?:\/\//.test(target.url);
  }

  async execute(target: DetectionTarget, _ctx: DetectionContext): Promise<DetectionResult> {
    const startedAt = new Date();
    const findings: Finding[] = [];

    const response = await fetch(target.url, { method: "HEAD" });
    const header = response.headers.get("x-frame-options");

    if (!header) {
      findings.push({
        id: "xfo-missing",
        title: "X-Frame-Options header is missing",
        severity: "medium",
        confidence: "certain",
        description: "The page can be embedded in an iframe, which enables clickjacking.",
        evidence: { type: "http_response", data: "No X-Frame-Options header observed." },
        recommendation: "Set X-Frame-Options: DENY or SAMEORIGIN, or use CSP frame-ancestors.",
        url: target.url,
        references: ["https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options"],
      });
    }

    return {
      detectionId: this.id,
      category: this.category,
      status: "completed",
      findings,
      score: findings.length === 0 ? 100 : 100 - findings.length * 25,
      metadata: { headerValue: header ?? null },
      startedAt,
      completedAt: new Date(),
    };
  }
}
```

### 2.4 Wrap it as a plugin (optional, for plugin-loader integration)

```ts
import { THPlugin, type THContainer } from "@test-harness/th-core";
import { XFrameOptionsDetection } from "./xframe.js";

export class XFramePlugin extends THPlugin {
  static manifest = {
    name: "@test-harness/th-detect-xframe",
    version: "0.1.0",
    description: "X-Frame-Options detection",
  };

  override activate(container: THContainer): void {
    // Pull the DetectionRegistry out of the container and register ourselves.
    const registry = container.get(DetectionRegistryDefinition);
    registry.register(new XFrameOptionsDetection());
  }

  override deactivate(): void {
    /* nothing to clean up */
  }
}
```

---

## 3. Tool (Complete Example)

Tools are the actions the agent loop can invoke via LLM tool calls. Each tool
declares a Zod input schema, an optional output schema, a timeout, and a
concurrency flag.

We'll build a tool that hits an HTTP endpoint and returns the response body.

### 3.1 `src/http-request.ts`

```ts
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";

const InputSchema = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "HEAD", "POST"]).default("GET"),
  headers: z.record(z.string()).optional(),
});

export function createHttpRequestTool(): Tool {
  return {
    id: "http_request",
    name: "HTTP Request",
    description: "Perform an HTTP request against the target URL.",
    category: "utility",
    inputSchema: InputSchema,
    outputSchema: z.object({
      status: z.number(),
      body: z.string(),
    }),
    timeoutMs: 15_000,
    isConcurrencySafe: () => true,   // read-only, safe to run in parallel

    async execute(input, ctx: ToolContext): Promise<ToolResult> {
      const start = Date.now();
      try {
        const parsed = InputSchema.parse(input);
        const res = await fetch(parsed.url, {
          method: parsed.method,
          headers: parsed.headers,
          signal: ctx.abortSignal,
        });
        const body = await res.text();
        return {
          success: true,
          data: { status: res.status, body: body.slice(0, 50_000) },
          duration: Date.now() - start,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          duration: Date.now() - start,
        };
      }
    },
  };
}
```

### 3.2 Register

```ts
registry.register(createHttpRequestTool());
```

---

## 4. LLM Adapter (Complete Example)

Every LLM backend implements `LLMProvider`. There are three required methods:
`complete`, `stream`, `countTokens`, and `healthCheck`.

### 4.1 `src/provider.ts`

```ts
import type {
  LLMProvider,
  CompletionParams,
  ModelResponse,
  StreamChunk,
  ModelCapability,
  Message,
  ToolSchema,
} from "@test-harness/th-protocol";

export class MyProvider implements LLMProvider {
  readonly id = "my-provider";
  readonly name = "My Provider";
  readonly capabilities: ModelCapability[] = ["chat", "tool_use", "streaming"];

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.my-provider.example.com",
  ) {}

  async complete(params: CompletionParams): Promise<ModelResponse> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        tools: params.tools,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        stop: params.stop,
      }),
      signal: params.signal,
    });
    if (!res.ok) throw new Error(`LLM request failed: ${res.status}`);
    const data = await res.json();
    return {
      id: data.id,
      content: data.choices[0].message.content,
      toolCalls: data.choices[0].message.tool_calls,
      usage: data.usage,
      finishReason: data.choices[0].finish_reason,
      model: data.model,
    };
  }

  async *stream(params: CompletionParams): AsyncIterable<StreamChunk> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ ...params, stream: true }),
      signal: params.signal,
    });
    for await (const line of streamSSE(res.body)) {
      if (line.data === "[DONE]") {
        yield { type: "done", data: "" };
        return;
      }
      const parsed = JSON.parse(line.data);
      const delta = parsed.choices[0].delta;
      if (delta.content) yield { type: "content", data: delta.content };
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          yield { type: "tool_call", data: tc };
        }
      }
      if (parsed.usage) yield { type: "usage", data: parsed.usage };
    }
  }

  async countTokens(messages: Message[], _tools?: ToolSchema[]): Promise<number> {
    return messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

async function* streamSSE(body: ReadableStream<Uint8Array> | null): AsyncIterable<{ data: string }> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) yield { data: line.slice(6).trim() };
    }
  }
}
```

---

## 5. Plugin Lifecycle

Every plugin subclasses `THPlugin`:

```ts
export abstract class THPlugin {
  abstract activate(container: THContainer): Promise<void> | void;
  abstract deactivate(): Promise<void> | void;
}
```

### Phases

1. **Manifest.** The static `manifest` describes the plugin (name, version,
   declared services, events it emits or consumes).
2. **Load.** The `PluginLoader` instantiates the plugin.
3. **Activate.** `activate(container)` is called. The plugin may:
   - Register services in the container
   - Subscribe to events on the container's EventBus
   - Allocate resources (file handles, network connections)
   - Push disposers onto the `EffectStack` for automatic cleanup
4. **Run.** The plugin participates in the application.
5. **Deactivate.** `deactivate()` is called in **reverse activation order**.
   Resources are released, subscriptions cancelled, services unregistered.

### Ordering guarantees

- Plugins activate in the order they were registered.
- Plugins deactivate in **reverse** order.
- If plugin B depends on plugin A, then B is registered after A, and B is
  torn down before A.

### Effect tracking

Plugins can register cleanup work without manually tracking it:

```ts
import { EffectStack } from "@test-harness/th-core";

override activate(container: THContainer): void {
  const stack = container.get(EffectStackDefinition);
  stack.track(() => this.db.close());
  stack.track(() => this.watcher.close());
}
```

All tracked effects run during `deactivate()`.

---

## 6. Service Definitions and Capability Seams

A **service definition** is a symbol-keyed handle that identifies a *capability
contract*. It is the Cordis "Definition → Provider → Consumer" triangle:

```
┌────────────────────────┐     ┌──────────────────────────┐
│ ServiceDefinition<T>   │     │ Provider                 │
│   id: Symbol(name)     │◄────│   registers impl of T    │
└──────────┬─────────────┘     └──────────────────────────┘
           │                              │
           │ container.get(def)           │
           ▼                              ▼
        ┌────────────────────────────────────┐
        │ Consumer                           │
        │   uses the service without         │
        │   knowing the concrete provider    │
        └────────────────────────────────────┘
```

### Defining a service

```ts
import { defineService } from "@test-harness/th-core";

export const LLMProviderDefinition = defineService<LLMProvider>("LLMProvider");
export const DetectionRegistryDefinition = defineService<DetectionRegistry>("DetectionRegistry");
```

### Providing

```ts
container.register(LLMProviderDefinition, new OllamaProvider("http://localhost:11434"));
```

### Consuming

```ts
const llm = container.get(LLMProviderDefinition);
const response = await llm.complete({ model: "llama3.1", messages: [...] });
```

### Built-in seams

| Definition | Implemented by | Consumed by |
|---|---|---|
| `LLMProvider` | `th-llm-ollama`, `th-llm-openai`, `th-llm-deepseek` | `th-agent` |
| `DetectionPlugin` | `th-detect-security`, `th-detect-performance`, ... | `th-detection` (runner) |
| `Tool` | `th-tools` (built-ins) | `th-agent` |
| `TaskQueue` | `th-queue` | `th-api`, `th-worker` |
| `DatabaseRepositories` | `th-persistence` | `th-api`, `th-worker` |

---

## 7. Event System

Test-Harness has **four dispatch modes**, each with its own semantics:

| Mode | Method | Returns | Behavior |
|---|---|---|---|
| `emit` | `bus.emit(event, data)` | `void` | Fire-and-forget notification |
| `waterfall` | `bus.waterfall(event, initial)` | `T` | Around-middleware chain |
| `serial` | `bus.serial(event, data)` | `R[]` | Sequential handlers, results collected |
| `parallel` | `bus.parallel(event, data)` | `void` | Concurrent handlers |

### 7.1 `emit` — observer notifications

```ts
bus.on(ScanCompletedEvent, (data) => {
  console.log(`Scan ${data.scanId} finished with score ${data.overallScore}`);
});

// ...
await bus.emit(ScanCompletedEvent, { scanId: "abc", overallScore: 85, findingSummary: {...} });
```

### 7.2 `waterfall` — around-middleware

Each handler receives `(data, next)`. Call `next(data)` to delegate, or
return without calling it to short-circuit.

```ts
bus.onWaterfall(AgentRequestEvent, async (config, next) => {
  config.temperature = 0.5;             // modify BEFORE next handler
  const result = await next(config);    // delegate down the chain
  return result;                        // can also modify the return
});

// Later:
const finalConfig = await bus.waterfall(AgentRequestEvent, initialConfig);
```

**Built-in waterfall events**

| Event | Purpose |
|---|---|
| `AgentPreStepEvent` | Modify or reject messages before the LLM sees them |
| `AgentRequestEvent` | Modify LLM request config (model, temperature) |
| `AgentTurnStoppingEvent` | Inject extra work to keep the turn alive |
| `ToolsPreExecuteEvent` | Approve / deny / modify tool input |
| `ToolsPostExecuteEvent` | Modify / replace tool results |

### 7.3 `serial` — ordered aggregation

Handlers run in registration order. Each result is pushed onto an array that
is returned to the caller.

```ts
bus.onSerial(AgentTurnStoppingEvent, async (data) => {
  if (hasPendingWork()) {
    data.shouldContinue = true;
    data.reason = "Pending tool calls in queue";
  }
  return data;
});

const results = await bus.serial(AgentTurnStoppingEvent, initialData);
const shouldContinue = results.some(r => r.shouldContinue);
```

### 7.4 Disposables

All registrations return a `Disposable`:

```ts
const sub = bus.on(SomeEvent, handler);
// later
sub.dispose();
```

Plugins can rely on `EffectStack` to dispose everything automatically at
deactivation time.

---

## 8. Tips

- **Keep plugins focused.** One capability per package.
- **Put the type in `th-protocol`**, the implementation in a leaf package.
  This way consumers never pull in your provider's deps.
- **Use waterfall events** for cross-cutting concerns: logging, metrics,
  approval gates.
- **Test the contract, not the implementation.** Write tests against the
  `DetectionPlugin` / `Tool` / `LLMProvider` interface so swapping providers
  is transparent.
- **Prefer `isConcurrencySafe: true`** when your tool has no side effects —
  the agent loop will schedule it in parallel and you'll get a big speedup.

---

## 9. Reference: Built-in Event Catalog

### Durable events (persisted to session log)

- `scan:created`
- `scan:status_changed`
- `detection:started`
- `detection:completed`
- `scan:completed`

### Live events (WebSocket / in-memory only)

- `agent:turn_started`
- `agent:tool_call`
- `agent:tool_result`
- `scan:progress`
- `agent:stream_chunk`

### Waterfall events (around-middleware)

- `agent:pre_step`
- `agent:request`
- `agent:turn_stopping`
- `tools:pre_execute`
- `tools:post_execute`

See `packages/protocol/th-protocol/src/events.ts` for the authoritative list.
