# Contributing to Test-Harness

Thanks for your interest in contributing! This guide covers how to get set up,
the conventions we follow, and the process for landing changes.

## 1. Project Overview

Test-Harness is a monorepo that builds an **AI-powered website quality analyzer**.
It crawls sites, runs detection plugins (security, performance, SEO,
accessibility), and feeds the results into an agent loop that uses an LLM to
interpret and summarize the findings.

The architecture is modeled on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
and its [Cordis](https://github.com/cordiverse/cordis) plugin framework.
Everything that is not the runtime itself — LLM adapters, detection modules,
tools, storage backends — is packaged as a plugin behind a typed service
definition (the *capability seam*).

## 2. Development Setup

### Prerequisites

- **Node.js 20+** (22 recommended) — see `engines` in the root `package.json`
- **pnpm 10** (managed by `corepack`)
- Git

### First-time setup

```bash
# 1. Clone the repo
git clone https://github.com/<your-org>/test-harness.git
cd test-harness

# 2. Enable corepack (pins pnpm to packageManager)
corepack enable

# 3. Install workspace dependencies
pnpm install

# 4. Run the full build
pnpm run build

# 5. Run the test suite
pnpm run test
```

### Running in development

```bash
# CLI
pnpm --filter @test-harness/th-cli dev -- scan https://example.com

# Server (REST + WebSocket, default port 3000)
pnpm --filter @test-harness/th-server dev

# Watch all workspaces in parallel
pnpm run dev
```

### Useful scripts

| Script | Description |
|---|---|
| `pnpm run build` | Build every workspace package (via turbo) |
| `pnpm run typecheck` | `tsc --noEmit` across all packages |
| `pnpm run test` | Run vitest across all packages |
| `pnpm run test:unit` | Unit tests with coverage |
| `pnpm run lint` | Lint every workspace |
| `pnpm run clean` | Remove all `dist/` folders |
| `pnpm run dev` | Run every workspace's `dev` in parallel |

## 3. Package Structure

All code lives in one of two top-level folders:

```
packages/     Library packages  (@test-harness/th-*)
apps/         Executable apps   (@test-harness/th-server)
```

### Naming conventions

- **NPM scope:** `@test-harness/`
- **Folder name:** `th-<feature>` (e.g. `th-core`, `th-llm-ollama`)
- **Package name:** `@test-harness/th-<feature>`
- **Entry point:** `src/index.ts` → compiled to `dist/index.js`
- **Test files:** `*.test.ts` alongside the source

### The core packages

| Package | Purpose |
|---|---|
| `th-protocol` | Shared types + Zod schemas. Zero runtime deps. |
| `th-core` | Plugin framework: DI, events, effects, service definitions |
| `th-llm` | LLM capability seam + abstract provider |
| `th-llm-ollama` | Ollama adapter |
| `th-llm-openai` | OpenAI-compatible adapter |
| `th-llm-deepseek` | DeepSeek adapter |
| `th-tools` | Tool framework + 16 built-in tools (browser/HTTP + 5 generalization tools) |
| `th-browser` | Browser capability seam + Playwright MCP + Generalization Layer (DOM distillation, SmartLocator, SiteProfile) |
| `th-agent` | Agent loop core (turn → model → tool → result) + workflow state machine |
| `th-persistence` | JSON file repositories |
| `th-queue` | In-process task queue |
| `th-worker` | Test session job processor |
| `th-report` | Report generator (JSON / Markdown / HTML) |
| `th-api` | REST + WebSocket server |
| `th-cli` | CLI (`th test <url>`) |

### Dependency rules

- **`th-protocol` is the leaf** — nothing it depends on except Zod.
- **`th-core` depends only on `th-protocol`**.
- Domain packages (`th-llm`, `th-tools`, `th-browser`) depend
  on `th-core` + `th-protocol`.
- Adapters (`th-llm-ollama`, `th-llm-openai`, ...) depend on the
  framework package they implement.
- Apps compose everything.

## 4. Code Style

- **ESM only.** Every package has `"type": "module"`. Use `import`/`export`.
- **Strict TypeScript.** `strict: true`, no `any` except with an eslint-disable
  comment and a justification.
- **`.js` imports.** Always use `.js` extensions in relative imports, even in
  `.ts` files (TypeScript's ESM rule):
  ```ts
  import { EventBusImpl } from "./event.js";
  ```
- **Workspace imports.** Never import across packages by relative path — use
  the package name:
  ```ts
  import type { Tool } from "@test-harness/th-protocol";
  ```
- **No frameworks.** The server is built on Node's `node:http`. Keep the
  dependency graph small.
- **Async by default.** Anything I/O-bound returns a `Promise`.
- **Immutability.** Prefer `readonly` fields and `as const` literals.

## 5. Adding a New Detection Plugin

Detection plugins are the easiest extension point. Each detection runs against
a URL target and returns a list of findings.

### Step-by-step

1. **Create the package.**

   ```bash
   mkdir packages/detection/th-detect-<name>
   cd packages/detection/th-detect-<name>
   mkdir src
   ```

2. **`package.json`** — follow the pattern:

   ```json
   {
     "name": "@test-harness/th-detect-<name>",
     "version": "0.1.0",
     "type": "module",
     "main": "./dist/index.js",
     "types": "./dist/index.d.ts",
     "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
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

   Copy `tsconfig.json` from another detection package.

3. **Implement the plugin.** In `src/index.ts`:

   ```ts
   import type {
     DetectionPlugin,
     DetectionTarget,
     DetectionContext,
     DetectionResult,
   } from "@test-harness/th-protocol";

   export class MyDetection implements DetectionPlugin {
     readonly id = "my-detection";
     readonly name = "My Detection";
     readonly category = "security";           // | "performance" | "seo" | "accessibility" | "functionality"
     readonly description = "Checks for X";
     readonly version = "0.1.0";

     async canExecute(target: DetectionTarget, _ctx: DetectionContext): Promise<boolean> {
       return target.url.startsWith("https://");
     }

     async execute(target: DetectionTarget, ctx: DetectionContext): Promise<DetectionResult> {
       const findings = [];
       // ... run checks, push Finding objects
       return {
         detectionId: this.id,
         category: this.category,
         status: "completed",
         findings,
         score: findings.length === 0 ? 100 : 0,
         metadata: {},
         startedAt: new Date(),
         completedAt: new Date(),
       };
     }
   }
   ```

4. **Register the detection.** In the server or CLI bootstrap:

   ```ts
   import { MyDetection } from "@test-harness/th-detect-<name>";
   detectionRegistry.register(new MyDetection());
   ```

5. **Write a test.** In `src/index.test.ts`:

   ```ts
   import { describe, it, expect } from "vitest";
   import { MyDetection } from "./index.js";

   describe("MyDetection", () => {
     it("returns a finding when X is missing", async () => {
       const d = new MyDetection();
       const result = await d.execute(
         { url: "https://example.com", scope: "page" },
         { scanId: "s1", config: {}, abortSignal: new AbortController().signal },
       );
       expect(result.status).toBe("completed");
     });
   });
   ```

6. **Add to the workspace.** Edit the root `pnpm-workspace.yaml` if your
   package lives outside `packages/**` (it shouldn't — the glob already covers it).

## 6. Adding a New LLM Adapter

LLM adapters implement the `LLMProvider` capability seam from `th-protocol`.

### Step-by-step

1. **Create the package** at `packages/llm/th-llm-<provider>/`.

2. **Implement `LLMProvider`:**

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

     constructor(private readonly apiKey: string, private readonly baseUrl: string) {}

     async complete(params: CompletionParams): Promise<ModelResponse> {
       // HTTP POST to this.baseUrl + "/chat/completions" (or provider-specific)
       // Return a ModelResponse
       throw new Error("not implemented");
     }

     async *stream(params: CompletionParams): AsyncIterable<StreamChunk> {
       // SSE-style streaming, yield StreamChunks
       throw new Error("not implemented");
     }

     async countTokens(messages: Message[], tools?: ToolSchema[]): Promise<number> {
       // Rough estimate; providers with a tokenizer endpoint should use it.
       return messages.reduce((acc, m) => acc + m.content.length / 4, 0) | 0;
     }

     async healthCheck(): Promise<boolean> {
       try {
         const res = await fetch(`${this.baseUrl}/models`);
         return res.ok;
       } catch {
         return false;
       }
     }
   }
   ```

3. **Package it as a plugin** (subclass `THPlugin`) if you want it loaded by the
   plugin loader. See `th-llm-ollama` for a reference.

4. **Write tests.** Use `fetch` mocks (Vitest's `vi.stubGlobal`) to fake the
   provider's HTTP API.

## 7. Adding a New Tool

Tools are the actions the agent loop can invoke through LLM tool calls.

### Step-by-step

1. **Create the tool** by implementing the `Tool` interface:

   ```ts
   import { z } from "zod";
   import type { Tool, ToolContext, ToolResult } from "@test-harness/th-protocol";

   export function createMyTool(): Tool {
     return {
       id: "my_tool",
       name: "My Tool",
       description: "Does X against the target URL",
       category: "utility",        // | "crawl" | "detection" | "analysis"
       inputSchema: z.object({
         url: z.string().url(),
         selector: z.string().optional(),
       }),
       outputSchema: z.object({ ok: z.boolean() }),
       timeoutMs: 10_000,
       isConcurrencySafe: () => true,   // opt into parallel execution
       async execute(input, ctx: ToolContext): Promise<ToolResult> {
         const start = Date.now();
         try {
           // do the work
           return { success: true, data: { ok: true }, duration: Date.now() - start };
         } catch (err) {
           return { success: false, error: String(err), duration: Date.now() - start };
         }
       },
     };
   }
   ```

2. **Register it** with the `ToolRegistry` during your plugin's `activate`:

   ```ts
   registry.register(createMyTool());
   ```

3. **Test it** in isolation — the tool's `execute` is a pure function of its
   input + context.

## 8. Testing Requirements

- **Every package has its own `vitest` suite.** Run `pnpm run test` at the root
  to execute them all.
- **Name tests** `*.test.ts` and colocate them next to the source.
- **What to test:**
  - Pure logic: scoring, schema validation, event dispatch.
  - Boundaries: plugin activation / deactivation, service resolution.
  - HTTP handlers: use the Node `http` module to start the API on an ephemeral
    port, make real requests.
- **Do not** test implementation details (private fields). Test observable
  behavior.
- **Aim for ≥80% line coverage** in `th-core`, `th-protocol`, `th-detection`,
  `th-tools`. Coverage reports are generated by `pnpm run test:unit`.

## 9. Pull Request Process

1. **Fork & branch.** Fork the repo and create a branch off `main`:
   ```bash
   git checkout -b feat/my-detection
   ```
2. **Make small, reviewable commits.** One logical change per commit.
3. **Keep the build green.** Before pushing, run locally:
   ```bash
   pnpm run build && pnpm run typecheck && pnpm run test && pnpm run lint
   ```
4. **Open a PR against `main`.** Fill out the PR template:
   - Summary of the change
   - Which package(s) are affected
   - Test plan
   - Screenshots / curl commands if user-visible
5. **CI runs automatically.** The GitHub Actions workflow (Node 20 + 22) must
   pass before merge.
6. **Code review.** At least one approval from a maintainer.
7. **Squash-merge.** We squash to keep history linear.

### Commit message convention

```
<type>(<package>): <short summary>

feat(th-detect-ssl): add TLS version detection
fix(th-agent): handle empty tool call arguments
docs(api): document the /scans/:id/report endpoint
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`.

## 10. Getting Help

- Open a [GitHub Issue](https://github.com/<your-org>/test-harness/issues) for
  bugs and feature requests.
- For architecture questions, start a Discussion.
- If you're stuck on a PR, ping a maintainer — we'd rather unblock you than
  let you spin.

Happy hacking!
