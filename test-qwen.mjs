#!/usr/bin/env node
/**
 * Quick Qwen API test — simulates exact Agent Loop request
 */
import "dotenv/config";

const API_KEY = process.env.DASHSCOPE_API_KEY;
const BASE_URL = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
const MODEL = process.env.QWEN_MODEL || "qwen-plus";

if (!API_KEY) {
  console.error("ERROR: DASHSCOPE_API_KEY not set in .env");
  process.exit(1);
}

console.log("=== Qwen API Debug (Agent Loop Simulation) ===");
console.log(`Base URL: ${BASE_URL}`);
console.log(`Model: ${MODEL}`);
console.log();

// Simulate exact Agent Loop request
console.log("--- Test: Exact Agent Loop Request ---");
const body = {
  model: MODEL,
  messages: [
    { role: "system", content: "You are a test agent." },
    { role: "user", content: "Test scan" }
  ],
  tools: [{
    type: "function",
    function: {
      name: "test_tool",
      description: "A test tool",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to test" }
        },
        required: ["url"]
      }
    }
  }],
  stream: true,
  temperature: 0.1,
};

console.log("Request:", JSON.stringify(body, null, 2));
console.log();

try {
  const r = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const text = await r.text();
  console.log(`Status: ${r.status}`);
  console.log(`Response (first 1000 chars):`);
  console.log(text.slice(0, 1000));
  console.log();

  if (r.status === 400) {
    console.log("=== 400 ERROR DETAIL ===");
    console.log("Check:");
    console.log("1. Model name - is it valid for your plan?");
    console.log("2. Tools format - must be OpenAI compatible");
    console.log("3. Messages format - role must be system/user/assistant/tool");
    console.log("4. Temperature - must be between 0 and 2");
  }
} catch (e) {
  console.error("Error:", e.message);
}
