/**
 * Settings routes — manage application settings.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "../http.js";
import fs from "node:fs";
import path from "node:path";

export interface SettingsRouteDeps {
  envPath: string;
}

interface UpdateSettingsRequest {
  llmProvider: string;
  llmModel: string;
  apiKey: string;
  baseUrl: string;
  maxTurns: string;
  maxRetriesPerAction: string;
  timeout: string;
  strategy: string;
}

/** PUT /api/v1/settings — update settings and write to .env */
export async function handleUpdateSettings(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SettingsRouteDeps
): Promise<void> {
  let body: UpdateSettingsRequest;
  try {
    body = await readJsonBody<UpdateSettingsRequest>(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  try {
    // Build .env content
    const envLines: string[] = [];

    // LLM Provider settings
    if (body.llmProvider === "qwen" || body.llmProvider === "dashscope") {
      if (body.apiKey) envLines.push(`DASHSCOPE_API_KEY=${body.apiKey}`);
      if (body.llmModel) envLines.push(`QWEN_MODEL=${body.llmModel}`);
      if (body.baseUrl) envLines.push(`DASHSCOPE_BASE_URL=${body.baseUrl}`);
    } else if (body.llmProvider === "openai") {
      if (body.apiKey) envLines.push(`OPENAI_API_KEY=${body.apiKey}`);
      if (body.llmModel) envLines.push(`OPENAI_MODEL=${body.llmModel}`);
      if (body.baseUrl) envLines.push(`OPENAI_BASE_URL=${body.baseUrl}`);
    } else if (body.llmProvider === "ollama") {
      if (body.baseUrl) envLines.push(`OLLAMA_URL=${body.baseUrl}`);
      if (body.llmModel) envLines.push(`OLLAMA_MODEL=${body.llmModel}`);
    }

    // Read existing .env and update
    let existingEnv = "";
    if (fs.existsSync(deps.envPath)) {
      existingEnv = fs.readFileSync(deps.envPath, "utf-8");
    }

    // Remove old keys that we're updating
    const keysToRemove = [
      "DASHSCOPE_API_KEY",
      "QWEN_MODEL",
      "DASHSCOPE_BASE_URL",
      "OPENAI_API_KEY",
      "OPENAI_MODEL",
      "OPENAI_BASE_URL",
      "OLLAMA_URL",
      "OLLAMA_MODEL",
    ];

    const lines = existingEnv.split("\n").filter((line) => {
      return !keysToRemove.some((key) => line.startsWith(`${key}=`));
    });

    // Add new settings
    const newEnv = [...lines, ...envLines].filter((l) => l.trim()).join("\n") + "\n";

    fs.writeFileSync(deps.envPath, newEnv, "utf-8");

    // Update process.env for current session
    for (const line of envLines) {
      const [key, value] = line.split("=");
      if (key && value) {
        process.env[key] = value;
      }
    }

    sendJson(res, 200, { success: true, message: "Settings updated. Server restart required for LLM changes." });
  } catch (err) {
    console.error("[Settings] Failed to update:", err);
    sendJson(res, 500, { error: "Failed to update settings" });
  }
}

/** Route dispatcher for settings endpoints */
export async function dispatchSettingsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SettingsRouteDeps,
  pathname: string
): Promise<boolean> {
  if (req.method === "PUT" && pathname === "/api/v1/settings") {
    await handleUpdateSettings(req, res, deps);
    return true;
  }
  return false;
}
