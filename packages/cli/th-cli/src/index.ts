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
    "LLM provider: ollama, openai, deepseek",
    "ollama"
  )
  .option("-m, --model <model>", "LLM model name", "llama3.1")
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
  .action(async (url: string, opts: Record<string, string>) => {
    try {
      await runScan(url, {
        scope: opts["scope"] as "page" | "site" | "domain",
        provider: opts["provider"],
        model: opts["model"],
        ollamaUrl: opts["ollamaUrl"],
        maxTurns: parseInt(opts["maxTurns"] ?? "15", 10),
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
