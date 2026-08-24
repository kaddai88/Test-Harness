/**
 * BrowserDriver service definition — the Capability Seam.
 *
 * Follows DSH's pattern:
 * - Service Definition declares the interface contract
 * - Provider implements it (PuppeteerBrowserProvider)
 * - Consumer uses it (Agent Loop tools)
 */
import { defineService } from "@test-harness/th-core";
import type { BrowserDriver } from "./types.js";

export const BrowserDriverDefinition =
  defineService<BrowserDriver>("BrowserDriver");
