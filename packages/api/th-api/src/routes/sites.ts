/**
 * Site Profile routes — manage site knowledge (learned patterns, auth hints, constraints).
 *
 * Endpoints:
 *   GET    /api/v1/sites              — list all site profiles (with cognition stats)
 *   GET    /api/v1/sites/:id          — get a single site profile (with cognition data)
 *   PUT    /api/v1/sites/:id          — update a site profile (merge fields)
 *   DELETE /api/v1/sites/:id          — delete a site profile (and cognition data)
 *   GET    /api/v1/sites/:id/cognition — get cognition data for a site
 *   DELETE /api/v1/sites/:id/cognition — clear cognition data for a site
 *   POST   /api/v1/sites/:id/cognition/feedback — flag knowledge as inaccurate
 *   POST   /api/v1/sites/:id/cognition/manual — add manual experience
 *   POST   /api/v1/sites/:id/cognition/:knowledgeId/weight — adjust knowledge weight
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson, matchRoute } from "../http.js";
import {
  loadSiteProfile,
  saveSiteProfile,
  type SiteProfileData,
} from "@test-harness/th-browser";
import { CognitiveEngine } from "@test-harness/th-cognition";
import fs from "node:fs";
import path from "node:path";

/** Default directory for site profile storage */
const DEFAULT_DIR = ".site-profiles";
/** Default directory for cognition storage */
const COGNITION_DIR = ".cognition";

/** Load cognition data for a specific site */
function loadCognitionForSite(hostname: string): {
  episodes: number;
  knowledge: number;
  procedures: number;
  patterns: number;
  recentEpisodes: Array<{
    id: string;
    type: string;
    outcome: string;
    description: string;
    timestamp: number;
  }>;
  recentKnowledge: Array<{
    id: string;
    type: string;
    title: string;
    confidence: number;
  }>;
} {
  const empty = {
    episodes: 0,
    knowledge: 0,
    procedures: 0,
    patterns: 0,
    recentEpisodes: [],
    recentKnowledge: [],
  };

  if (!fs.existsSync(COGNITION_DIR)) return empty;

  try {
    // Count episodes for this site
    const episodesPath = path.join(COGNITION_DIR, "episodes.json");
    let episodes: Array<{ id: string; type: string; outcome: string; description: string; timestamp: number; targetUrl: string }> = [];
    if (fs.existsSync(episodesPath)) {
      episodes = JSON.parse(fs.readFileSync(episodesPath, "utf-8"));
    }
    const siteEpisodes = episodes.filter(e => e.targetUrl?.includes(hostname));

    // Count semantic knowledge for this site
    const semanticPath = path.join(COGNITION_DIR, "semantic.json");
    let knowledge: Array<{ id: string; type: string; title: string; confidence: number; targetUrl?: string }> = [];
    if (fs.existsSync(semanticPath)) {
      knowledge = JSON.parse(fs.readFileSync(semanticPath, "utf-8"));
    }
    const siteKnowledge = knowledge.filter(k => !k.targetUrl || k.targetUrl?.includes(hostname));

    // Count procedures for this site
    const proceduresPath = path.join(COGNITION_DIR, "procedures.json");
    let procedures: Array<{ id: string; targetUrl?: string }> = [];
    if (fs.existsSync(proceduresPath)) {
      procedures = JSON.parse(fs.readFileSync(proceduresPath, "utf-8"));
    }
    const siteProcedures = procedures.filter(p => !p.targetUrl || p.targetUrl?.includes(hostname));

    // Count patterns for this site
    const patternsPath = path.join(COGNITION_DIR, "patterns.json");
    let patterns: Array<{ id: string; targetUrl?: string }> = [];
    if (fs.existsSync(patternsPath)) {
      patterns = JSON.parse(fs.readFileSync(patternsPath, "utf-8"));
    }
    const sitePatterns = patterns.filter(p => !p.targetUrl || p.targetUrl?.includes(hostname));

    return {
      episodes: siteEpisodes.length,
      knowledge: siteKnowledge.length,
      procedures: siteProcedures.length,
      patterns: sitePatterns.length,
      recentEpisodes: siteEpisodes
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5)
        .map(e => ({
          id: e.id,
          type: e.type,
          outcome: e.outcome,
          description: e.description,
          timestamp: e.timestamp,
        })),
      recentKnowledge: siteKnowledge
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5)
        .map(k => ({
          id: k.id,
          type: k.type,
          title: k.title,
          confidence: k.confidence,
        })),
    };
  } catch {
    return empty;
  }
}

/** Clear cognition data for a specific site */
function clearCognitionForSite(hostname: string): boolean {
  if (!fs.existsSync(COGNITION_DIR)) return false;

  let cleared = false;
  try {
    // Filter episodes
    const episodesPath = path.join(COGNITION_DIR, "episodes.json");
    if (fs.existsSync(episodesPath)) {
      const episodes = JSON.parse(fs.readFileSync(episodesPath, "utf-8"));
      const filtered = episodes.filter((e: { targetUrl?: string }) => !e.targetUrl?.includes(hostname));
      if (filtered.length < episodes.length) {
        fs.writeFileSync(episodesPath, JSON.stringify(filtered, null, 2), "utf-8");
        cleared = true;
      }
    }

    // Filter semantic knowledge
    const semanticPath = path.join(COGNITION_DIR, "semantic.json");
    if (fs.existsSync(semanticPath)) {
      const knowledge = JSON.parse(fs.readFileSync(semanticPath, "utf-8"));
      const filtered = knowledge.filter((k: { targetUrl?: string }) => !k.targetUrl?.includes(hostname));
      if (filtered.length < knowledge.length) {
        fs.writeFileSync(semanticPath, JSON.stringify(filtered, null, 2), "utf-8");
        cleared = true;
      }
    }

    // Filter procedures
    const proceduresPath = path.join(COGNITION_DIR, "procedures.json");
    if (fs.existsSync(proceduresPath)) {
      const procedures = JSON.parse(fs.readFileSync(proceduresPath, "utf-8"));
      const filtered = procedures.filter((p: { targetUrl?: string }) => !p.targetUrl?.includes(hostname));
      if (filtered.length < procedures.length) {
        fs.writeFileSync(proceduresPath, JSON.stringify(filtered, null, 2), "utf-8");
        cleared = true;
      }
    }

    return cleared;
  } catch {
    return cleared;
  }
}

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

/** GET /api/v1/sites — list all site profiles (with cognition stats) */
async function handleListSites(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const profiles = listAllProfiles();
  // Enrich each profile with cognition stats
  const enriched = profiles.map(profile => ({
    ...profile,
    cognition: loadCognitionForSite(profile.baseUrl),
  }));
  sendJson(res, 200, { sites: enriched });
}

/** GET /api/v1/sites/:id — get a single site profile (with cognition data) */
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
  const cognition = loadCognitionForSite(hostname);
  sendJson(res, 200, { site: profile, cognition });
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

/** DELETE /api/v1/sites/:id — delete a site profile (and cognition data) */
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
  // Also clear cognition data
  clearCognitionForSite(hostname);
  sendJson(res, 200, { success: true, message: `Site profile "${hostname}" and related cognition data deleted` });
}

/** GET /api/v1/sites/:id/cognition — get cognition data for a site */
async function handleGetCognition(
  _req: IncomingMessage,
  res: ServerResponse,
  hostname: string,
): Promise<void> {
  const cognition = loadCognitionForSite(hostname);
  sendJson(res, 200, { cognition });
}

/** DELETE /api/v1/sites/:id/cognition — clear cognition data for a site */
async function handleClearCognition(
  _req: IncomingMessage,
  res: ServerResponse,
  hostname: string,
): Promise<void> {
  const cleared = clearCognitionForSite(hostname);
  sendJson(res, 200, { success: cleared, message: cleared ? `Cognition data cleared for "${hostname}"` : `No cognition data found for "${hostname}"` });
}

/** POST /api/v1/sites/:id/cognition/feedback — flag knowledge as inaccurate */
async function handleFlagKnowledge(
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

  const { knowledgeId, reason } = body;
  if (!knowledgeId || !reason) {
    sendJson(res, 400, { error: "Missing knowledgeId or reason" });
    return;
  }

  try {
    const engine = new CognitiveEngine({ storagePath: path.resolve(process.cwd(), COGNITION_DIR) });
    const success = engine.flagKnowledgeAsInaccurate(knowledgeId as string, reason as string);
    sendJson(res, 200, { success, message: success ? `Knowledge flagged as inaccurate` : `Knowledge not found` });
  } catch (err) {
    console.error("[Sites] Failed to flag knowledge:", err);
    sendJson(res, 500, { error: "Failed to flag knowledge" });
  }
}

/** POST /api/v1/sites/:id/cognition/manual — add manual experience */
async function handleAddManualExperience(
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

  const { description, type, outcome, findings } = body;
  if (!description || !type || !outcome) {
    sendJson(res, 400, { error: "Missing required fields: description, type, outcome" });
    return;
  }

  try {
    const engine = new CognitiveEngine({ storagePath: path.resolve(process.cwd(), COGNITION_DIR) });
    const episodeId = engine.addManualExperience({
      targetUrl: hostname,
      description: description as string,
      type: type as 'session_summary' | 'bug_found' | 'recovery_success' | 'site_discovery',
      outcome: outcome as 'success' | 'failure' | 'partial' | 'neutral',
      findings: findings as Array<{ severity: string; title: string; description: string }>,
    });
    sendJson(res, 201, { success: true, episodeId, message: "Manual experience added" });
  } catch (err) {
    console.error("[Sites] Failed to add manual experience:", err);
    sendJson(res, 500, { error: "Failed to add manual experience" });
  }
}

/** POST /api/v1/sites/:id/cognition/:knowledgeId/weight — adjust knowledge weight */
async function handleAdjustWeight(
  req: IncomingMessage,
  res: ServerResponse,
  hostname: string,
  knowledgeId: string,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody<Record<string, unknown>>(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const { factor } = body;
  if (typeof factor !== 'number') {
    sendJson(res, 400, { error: "Missing or invalid factor (must be a number)" });
    return;
  }

  try {
    const engine = new CognitiveEngine({ storagePath: path.resolve(process.cwd(), COGNITION_DIR) });
    const success = engine.adjustKnowledgeWeight(knowledgeId, factor);
    sendJson(res, 200, { success, message: success ? `Knowledge weight adjusted` : `Knowledge not found` });
  } catch (err) {
    console.error("[Sites] Failed to adjust weight:", err);
    sendJson(res, 500, { error: "Failed to adjust knowledge weight" });
  }
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

  // POST /api/v1/sites/:id/cognition/feedback
  const feedbackMatch = matchRoute("/api/v1/sites/:id/cognition/feedback", pathname);
  if (feedbackMatch && req.method === "POST") {
    await handleFlagKnowledge(req, res, feedbackMatch.id!);
    return true;
  }

  // POST /api/v1/sites/:id/cognition/manual
  const manualMatch = matchRoute("/api/v1/sites/:id/cognition/manual", pathname);
  if (manualMatch && req.method === "POST") {
    await handleAddManualExperience(req, res, manualMatch.id!);
    return true;
  }

  // POST /api/v1/sites/:id/cognition/:knowledgeId/weight
  const weightMatch = matchRoute("/api/v1/sites/:id/cognition/:knowledgeId/weight", pathname);
  if (weightMatch && req.method === "POST") {
    await handleAdjustWeight(req, res, weightMatch.id!, weightMatch.knowledgeId!);
    return true;
  }

  // GET /api/v1/sites/:id/cognition
  const getCogMatch = matchRoute("/api/v1/sites/:id/cognition", pathname);
  if (getCogMatch && req.method === "GET") {
    await handleGetCognition(req, res, getCogMatch.id!);
    return true;
  }

  // DELETE /api/v1/sites/:id/cognition
  const delCogMatch = matchRoute("/api/v1/sites/:id/cognition", pathname);
  if (delCogMatch && req.method === "DELETE") {
    await handleClearCognition(req, res, delCogMatch.id!);
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
