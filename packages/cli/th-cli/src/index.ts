#!/usr/bin/env node

/**
 * TestHarness CLI — AI-driven website testing platform.
 *
 * DSH-style architecture:
 * User describes what to test → LLM plans → executes browser actions → streams results
 *
 * Usage:
 *   th test <url> --instructions "Test the login functionality"
 *   th test <url> --instructions "Check all forms work correctly"
 *   th --help
 */

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..", "..", "..");
const dotenv = await import("dotenv");
dotenv.config({ path: path.join(rootDir, ".env") });

import { Command } from "commander";
import { runTest } from "./commands/test.js";

const program = new Command();

program
  .name("th")
  .description("TestHarness — AI-driven website testing platform")
  .version("2.0.0");

program
  .command("test")
  .description("Run AI-driven website test")
  .argument("<url>", "Target URL to test")
  .option(
    "-i, --instructions <text>",
    "Natural language test instructions",
    "Perform a basic functionality test"
  )
  .option(
    "-p, --provider <provider>",
    "LLM provider: qwen, openai, ollama",
    "qwen"
  )
  .option("-m, --model <model>", "LLM model name", process.env.QWEN_MODEL || "qwen3.7-plus")
  .option(
    "--ollama-url <url>",
    "Ollama base URL",
    "http://localhost:11434"
  )
  .option(
    "--max-turns <n>",
    "Maximum agent loop turns",
    "20"
  )
  .option(
    "--no-browser",
    "Disable browser automation (no Puppeteer)"
  )
  .action(async (url: string, opts: Record<string, unknown>) => {
    try {
      await runTest(url, {
        instructions: opts["instructions"] as string,
        provider: opts["provider"] as string | undefined,
        model: opts["model"] as string | undefined,
        ollamaUrl: opts["ollamaUrl"] as string | undefined,
        maxTurns: parseInt((opts["maxTurns"] as string) ?? "20", 10),
        noBrowser: opts["browser"] === false,
      });
    } catch (err) {
      console.error(
        "Fatal error:",
        err instanceof Error ? err.message : String(err)
      );
      process.exit(1);
    }
  });

program.parse();
