/**
 * Site Profile routes — manage site knowledge (learned patterns, auth hints, constraints).
 *
 * Endpoints:
 *   GET    /api/v1/sites          — list all site profiles
 *   GET    /api/v1/sites/:id      — get a single site profile
 *   PUT    /api/v1/sites/:id      — update a site profile (merge fields)
 *   DELETE /api/v1/sites/:id      — delete a site profile
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson, matchRoute } from "../http.js";
import {
  loadSiteProfile,
  saveSiteProfile,
  type SiteProfileData,
} from "@test-harness/th-browser";
import fs from "node:fs";
import path from "node:path";

/** Default directory for site profile storage */
const DEFAULT_DIR = ".site-profiles";

/** List all site profiles from disk */
function listAllProfiles(): SiteProfileData[] {
  const dir = DEFAULT_DIR;
  if (!fs.existsSync(dir)) return [];

  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
    const profiles: SiteProfileData[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), "utf-8");
        profiles.push(JSON.parse(raw) as SiteProfileData);
      } catch {
        // Skip corrupted files
      }
    }
    return profiles;
  } catch {
    return [];
  }
}

/** Delete a site profile file by hostname */
function deleteProfile(hostname: string): boolean {
  const dir = DEFAULT_DIR;
  const filePath = path.join(dir, `${hostname}.json`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

/** GET /api/v1/sites — list all site profiles */
async function handleListSites(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const profiles = listAllProfiles();
  sendJson(res, 200, { sites: profiles });
}

/** GET /api/v1/sites/:id — get a single site profile */
async function handleGetSite(
  req: IncomingMessage,
  res: ServerResponse,
  hostname: string,
): Promise<void> {
  const profile = loadSiteProfile(hostname);
  if (!profile) {
    sendJson(res, 404, { error: `No site profile found for "${hostname}"` });
    return;
  }
  sendJson(res, 200, { site: profile });
}

/** PUT /api/v1/sites/:id — update a site profile */
async function handleUpdateSite(
  req: IncomingMessage,
  res: ServerResponse,
  hostname: string,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody<Record<string, unknown>>(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  try {
    const existing = loadSiteProfile(hostname);
    const profile: SiteProfileData = existing ?? {
      name: hostname,
      baseUrl: hostname,
      elementCache: [],
      updatedAt: Date.now(),
    };

    // Merge allowed fields
    if (typeof body.name === "string") profile.name = body.name;
    if (typeof body.baseUrl === "string") profile.baseUrl = body.baseUrl;

    // Allow clearing element cache
    if (body.clearCache === true) {
      profile.elementCache = [];
    }

    profile.updatedAt = Date.now();
    saveSiteProfile(profile);

    sendJson(res, 200, { success: true, site: profile });
  } catch (err) {
    console.error("[Sites] Failed to update:", err);
    sendJson(res, 500, { error: "Failed to update site profile" });
  }
}

/** DELETE /api/v1/sites/:id — delete a site profile */
async function handleDeleteSite(
  _req: IncomingMessage,
  res: ServerResponse,
  hostname: string,
): Promise<void> {
  const deleted = deleteProfile(hostname);
  if (!deleted) {
    sendJson(res, 404, { error: `No site profile found for "${hostname}"` });
    return;
  }
  sendJson(res, 200, { success: true, message: `Site profile "${hostname}" deleted` });
}

/** Route dispatcher for site profile endpoints */
export async function dispatchSiteRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  // GET /api/v1/sites
  if (req.method === "GET" && pathname === "/api/v1/sites") {
    await handleListSites(req, res);
    return true;
  }

  // GET /api/v1/sites/:id
  const getMatch = matchRoute("/api/v1/sites/:id", pathname);
  if (getMatch && req.method === "GET") {
    await handleGetSite(req, res, getMatch.id!);
    return true;
  }

  // PUT /api/v1/sites/:id
  const putMatch = matchRoute("/api/v1/sites/:id", pathname);
  if (putMatch && req.method === "PUT") {
    await handleUpdateSite(req, res, putMatch.id!);
    return true;
  }

  // DELETE /api/v1/sites/:id
  const delMatch = matchRoute("/api/v1/sites/:id", pathname);
  if (delMatch && req.method === "DELETE") {
    await handleDeleteSite(req, res, delMatch.id!);
    return true;
  }

  return false;
}
