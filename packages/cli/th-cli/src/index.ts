#!/usr/bin/env node

/**
 * TestHarness CLI — AI-powered website quality analyzer.
 *
 * Usage:
 *   th scan <url>          Run a website scan
 *   th scan <url> --scope site    Scan entire site
 *   th --help              Show help
 */

import { Command } from "commander";
import { runScan } from "./commands/scan.js";

const program = new Command();

program
  .name("th")
  .description("TestHarness — AI-powered website quality analyzer")
  .version("0.1.0");

program
  .command("scan")
  .description("Scan a website for quality issues")
  .argument("<url>", "Target URL to scan")
  .option(
    "-s, --scope <scope>",
    "Scan scope: page, site, domain",
    "page"
  )
  .option(
    "-p, --provider <provider>",
    "LLM provider: qwen, openai, deepseek, ollama",
    "qwen"
  )
  .option("-m, --model <model>", "LLM model name", "qwen-plus")
  .option(
    "--ollama-url <url>",
    "Ollama base URL",
    "http://localhost:11434"
  )
  .option(
    "--max-turns <n>",
    "Maximum agent loop turns",
    "15"
  )
  .option(
    "--no-browser",
    "Disable browser tools (no Puppeteer launch)"
  )
  .action(async (url: string, opts: Record<string, unknown>) => {
    try {
      await runScan(url, {
        scope: opts["scope"] as "page" | "site" | "domain",
        provider: opts["provider"] as string | undefined,
        model: opts["model"] as string | undefined,
        ollamaUrl: opts["ollamaUrl"] as string | undefined,
        maxTurns: parseInt((opts["maxTurns"] as string) ?? "15", 10),
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
