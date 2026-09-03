/**
 * SiteProfile Store — file-based persistence for SmartLocator cache.
 *
 * Stores per-site element caches as JSON files in a configurable directory.
 * Each site gets a file named by its hostname (e.g., `example.com.json`).
 *
 * Phase 2 of the generalization layer: the SmartLocator auto-learns
 * selectors during a session. This store persists them across sessions
 * so the next run starts with Level 1 cache hits instead of cold starts.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CachedElement } from "./site-profile.js";

/** Default directory for site profile storage */
const DEFAULT_DIR = ".site-profiles";

/** On-disk format for a site profile cache */
export interface SiteProfileData {
  name: string;
  baseUrl: string;
  elementCache: CachedElement[];
  updatedAt: number;
}

/**
 * Load a site profile cache from disk.
 * Returns null if no cache exists for this URL.
 */
export function loadSiteProfile(
  targetUrl: string,
  baseDir?: string
): SiteProfileData | null {
  const dir = baseDir ?? DEFAULT_DIR;
  const hostname = extractHostname(targetUrl);
  if (!hostname) return null;

  const filePath = join(dir, `${hostname}.json`);
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as SiteProfileData;
    return data;
  } catch {
    return null;
  }
}

/**
 * Save a site profile cache to disk.
 * Creates the directory if it doesn't exist.
 */
export function saveSiteProfile(
  data: SiteProfileData,
  baseDir?: string
): void {
  const dir = baseDir ?? DEFAULT_DIR;
  const hostname = extractHostname(data.baseUrl);
  if (!hostname) return;

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const filePath = join(dir, `${hostname}.json`);
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Extract the element cache from a browser provider and save it.
 * Called after a session completes to persist learned selectors.
 */
export function persistSiteCache(
  targetUrl: string,
  cache: CachedElement[],
  baseDir?: string
): void {
  if (cache.length === 0) return;

  const existing = loadSiteProfile(targetUrl, baseDir);
  const data: SiteProfileData = {
    name: existing?.name ?? extractHostname(targetUrl) ?? "",
    baseUrl: targetUrl,
    elementCache: cache,
    updatedAt: Date.now(),
  };
  saveSiteProfile(data, baseDir);
}

/**
 * Load the element cache for a target URL.
 * Returns the CachedElement array (empty if no prior cache).
 */
export function loadSiteCache(
  targetUrl: string,
  baseDir?: string
): CachedElement[] {
  const data = loadSiteProfile(targetUrl, baseDir);
  return data?.elementCache ?? [];
}

/** Extract hostname from a URL */
function extractHostname(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/[^a-zA-Z0-9.-]/g, "_");
  } catch {
    return null;
  }
}
