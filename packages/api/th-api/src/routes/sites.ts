/**
 * Site Profile routes — manage site knowledge and cognition data.
 *
 * All data is stored in the structured database (th-persistence).
 * Sites are keyed by NORMALIZED hostname (e.g., "bing.com").
 * All cognition data links to sites via `siteId` FK.
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
import type { DatabaseRepositories } from "@test-harness/th-persistence";
import { readJsonBody, sendJson, matchRoute } from "../http.js";
import fs from "node:fs";
import path from "node:path";

export interface SiteRouteDeps {
  repos: DatabaseRepositories;
}

// ── URL Normalization ──
// All URLs are normalized to hostname for consistent key naming.
// "https://www.bing.com/search?q=test" → "bing.com"
// "https://bing.com/" → "bing.com"

/** Normalize any URL to its hostname (without www. prefix) */
function normalizeToHostname(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove www. prefix for consistency
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith("www.")) {
      hostname = hostname.slice(4);
    }
    return hostname;
  } catch {
    // If not a valid URL, treat as hostname already
    let hostname = url.toLowerCase().trim();
    if (hostname.startsWith("www.")) {
      hostname = hostname.slice(4);
    }
    // Remove any path/query fragments
    const slashIdx = hostname.indexOf("/");
    if (slashIdx > 0) hostname = hostname.slice(0, slashIdx);
    return hostname;
  }
}

/** Ensure a site profile exists for the given hostname, creating if needed */
async function ensureSiteProfile(
  repos: DatabaseRepositories,
  hostname: string,
): Promise<{ id: string; name: string; baseUrl: string }> {
  const existing = await repos.sites.findByBaseUrl(hostname);
  if (existing) return existing;

  // Auto-create site profile for this hostname
  const site = await repos.sites.create({
    name: hostname,
    baseUrl: hostname,
  });
  return site;
}

// ── File Sync ──
// The browser agent writes site profiles to .site-profiles/ files during sessions.
// The cognitive engine writes to .cognition/ files.
// This syncs those files into the structured database.

const SITE_PROFILES_DIR = ".site-profiles";
const COGNITION_DIR = ".cognition";
let lastSyncTime = 0;

/** Sync site profile files into the database (incremental, based on file mtime) */
async function syncSiteProfilesFromFiles(repos: DatabaseRepositories): Promise<void> {
  if (!fs.existsSync(SITE_PROFILES_DIR)) return;

  try {
    const files = fs.readdirSync(SITE_PROFILES_DIR).filter(f => f.endsWith(".json"));
    for (const file of files) {
      const filePath = path.join(SITE_PROFILES_DIR, file);
      const stat = fs.statSync(filePath);
      // Only sync files modified since last sync
      if (stat.mtimeMs <= lastSyncTime) continue;

      try {
        const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        // Normalize the URL to hostname
        const rawUrl = raw.baseUrl ?? raw.name ?? file.replace(".json", "");
        const hostname = normalizeToHostname(rawUrl);

        const existing = await repos.sites.findByBaseUrl(hostname);
        if (existing) {
          await repos.sites.update(existing.id, {
            name: raw.name ?? existing.name,
            elementCache: JSON.stringify(raw.elementCache ?? []),
          });
        } else {
          await repos.sites.create({
            name: raw.name ?? hostname,
            baseUrl: hostname,
            elementCache: raw.elementCache ?? [],
          });
        }
      } catch {
        // Skip corrupted files
      }
    }
    lastSyncTime = Date.now();
  } catch {
    // Directory read errors are non-fatal
  }
}

/** Sync cognition files (.cognition/) into the structured database */
async function syncCognitionFromFiles(repos: DatabaseRepositories): Promise<void> {
  if (!fs.existsSync(COGNITION_DIR)) return;

  try {
    // Sync episodes
    const episodesPath = path.join(COGNITION_DIR, "episodes.json");
    if (fs.existsSync(episodesPath)) {
      const episodes = JSON.parse(fs.readFileSync(episodesPath, "utf-8"));
      for (const ep of episodes) {
        if (!ep.id || !ep.targetUrl) continue;

        // Normalize URL to hostname and ensure site exists
        const hostname = normalizeToHostname(ep.targetUrl);
        const site = await ensureSiteProfile(repos, hostname);

        // Check if episode already exists in DB
        const existingEpisodes = await repos.cognition.listEpisodesBySite(site.id);
        const found = existingEpisodes.find(e => e.id === ep.id);
        if (!found) {
          await repos.cognition.createEpisode({
            siteId: site.id,
            sessionId: ep.sessionId ?? null,
            type: ep.type ?? "session_summary",
            outcome: ep.outcome ?? "neutral",
            description: ep.description ?? "",
            data: JSON.stringify(ep),
            timestamp: ep.timestamp ?? Date.now(),
          });
          // Increment test count for session_summary episodes
          if (ep.type === "session_summary") {
            await repos.sites.incrementTestCount(site.id);
          }
        }
      }
    }

    // Sync semantic knowledge
    const semanticPath = path.join(COGNITION_DIR, "semantic.json");
    if (fs.existsSync(semanticPath)) {
      const knowledge = JSON.parse(fs.readFileSync(semanticPath, "utf-8"));
      for (const k of knowledge) {
        if (!k.id) continue;

        const existing = await repos.cognition.getKnowledge(k.id);
        if (!existing) {
          // Determine siteId from targetUrl
          let siteId: string | null = null;
          if (k.targetUrl) {
            const hostname = normalizeToHostname(k.targetUrl);
            const site = await ensureSiteProfile(repos, hostname);
            siteId = site.id;
          }

          await repos.cognition.createKnowledge({
            siteId,
            type: k.type ?? "site_characteristic",
            title: k.title ?? "Untitled",
            content: k.content ?? "",
            confidence: k.confidence ?? 0.5,
            tags: JSON.stringify(k.tags ?? []),
          });
        } else {
          // Update confidence if changed
          if (existing.confidence !== k.confidence) {
            await repos.cognition.updateKnowledge(k.id, { confidence: k.confidence });
          }
        }
      }
    }

    // Sync procedures
    const proceduresPath = path.join(COGNITION_DIR, "procedures.json");
    if (fs.existsSync(proceduresPath)) {
      const procedures = JSON.parse(fs.readFileSync(proceduresPath, "utf-8"));
      for (const p of procedures) {
        if (!p.id || !p.name) continue;

        let siteId: string | null = null;
        if (p.targetUrl) {
          const hostname = normalizeToHostname(p.targetUrl);
          const site = await ensureSiteProfile(repos, hostname);
          siteId = site.id;
        }

        // Check if already synced
        const existing = await repos.cognition.listProceduresBySite(siteId ?? "");
        const found = existing.find(proc => proc.name === p.name);
        if (!found) {
          await repos.cognition.createProcedure({
            siteId,
            name: p.name,
            steps: JSON.stringify(p.steps ?? []),
            successRate: p.successRate ?? 0,
          });
        }
      }
    }

    // Sync patterns
    const patternsPath = path.join(COGNITION_DIR, "patterns.json");
    if (fs.existsSync(patternsPath)) {
      const patterns = JSON.parse(fs.readFileSync(patternsPath, "utf-8"));
      for (const p of patterns) {
        if (!p.id || !p.description) continue;

        let siteId: string | null = null;
        if (p.targetUrl) {
          const hostname = normalizeToHostname(p.targetUrl);
          const site = await ensureSiteProfile(repos, hostname);
          siteId = site.id;
        }

        // Check if already synced
        const existing = await repos.cognition.listPatternsBySite(siteId ?? "");
        const found = existing.find(pat => pat.description === p.description);
        if (!found) {
          await repos.cognition.createPattern({
            siteId,
            type: p.type ?? "behavioral",
            description: p.description,
            frequency: p.frequency ?? 0,
            confidence: p.confidence ?? 0.5,
            tags: JSON.stringify(p.tags ?? []),
          });
        }
      }
    }
  } catch {
    // Cognition sync errors are non-fatal
  }
}

// ── Helpers ──

function nowIso(): string {
  return new Date().toISOString();
}

// ── Handlers ──

/** GET /api/v1/sites — list all site profiles (with cognition stats) */
async function handleListSites(
  _req: IncomingMessage,
  res: ServerResponse,
  deps: SiteRouteDeps,
): Promise<void> {
  // Sync from file system (browser agent writes to .site-profiles/ and .cognition/)
  await syncSiteProfilesFromFiles(deps.repos);
  await syncCognitionFromFiles(deps.repos);

  const sites = await deps.repos.sites.findAll();
  const enriched = await Promise.all(
    sites.map(async (site) => {
      const [ep, kn, pr, pa] = await Promise.all([
        deps.repos.cognition.listEpisodesBySite(site.id),
        deps.repos.cognition.listKnowledgeBySite(site.id),
        deps.repos.cognition.listProceduresBySite(site.id),
        deps.repos.cognition.listPatternsBySite(site.id),
      ]);

      return {
        id: site.id,
        name: site.name,
        baseUrl: site.baseUrl,
        elementCache: JSON.parse(site.elementCache || "[]"),
        testCount: site.testCount,
        lastTestedAt: site.lastTestedAt,
        updatedAt: site.updatedAt,
        cognition: {
          episodes: ep.length,
          knowledge: kn.length,
          procedures: pr.length,
          patterns: pa.length,
          recentEpisodes: ep.slice(0, 5).map((e) => ({
            id: e.id,
            type: e.type,
            outcome: e.outcome,
            description: e.description,
            timestamp: e.timestamp,
          })),
          recentKnowledge: kn.slice(0, 5).map((k) => ({
            id: k.id,
            type: k.type,
            title: k.title,
            confidence: k.confidence,
          })),
        },
      };
    })
  );
  sendJson(res, 200, { sites: enriched });
}

/** GET /api/v1/sites/:id — get a single site profile (with cognition data) */
async function handleGetSite(
  _req: IncomingMessage,
  res: ServerResponse,
  hostname: string,
  deps: SiteRouteDeps,
): Promise<void> {
  // Sync from file system first
  await syncSiteProfilesFromFiles(deps.repos);
  await syncCognitionFromFiles(deps.repos);

  // Normalize the hostname
  const normalizedHostname = normalizeToHostname(hostname);
  const site = await deps.repos.sites.findByBaseUrl(normalizedHostname);
  if (!site) {
    sendJson(res, 404, { error: `No site profile found for "${normalizedHostname}"` });
    return;
  }

  const [episodes, knowledge, procedures, patterns] = await Promise.all([
    deps.repos.cognition.listEpisodesBySite(site.id),
    deps.repos.cognition.listKnowledgeBySite(site.id),
    deps.repos.cognition.listProceduresBySite(site.id),
    deps.repos.cognition.listPatternsBySite(site.id),
  ]);

  sendJson(res, 200, {
    site: {
      id: site.id,
      name: site.name,
      baseUrl: site.baseUrl,
      elementCache: JSON.parse(site.elementCache || "[]"),
      testCount: site.testCount,
      lastTestedAt: site.lastTestedAt,
      updatedAt: site.updatedAt,
    },
    cognition: {
      episodes: episodes.length,
      knowledge: knowledge.length,
      procedures: procedures.length,
      patterns: patterns.length,
      recentEpisodes: episodes.slice(0, 10).map((e) => ({
        id: e.id,
        type: e.type,
        outcome: e.outcome,
        description: e.description,
        timestamp: e.timestamp,
      })),
      recentKnowledge: knowledge.slice(0, 10).map((k) => ({
        id: k.id,
        type: k.type,
        title: k.title,
        confidence: k.confidence,
      })),
    },
  });
}

/** PUT /api/v1/sites/:id — update a site profile */
async function handleUpdateSite(
  req: IncomingMessage,
  res: ServerResponse,
  hostname: string,
  deps: SiteRouteDeps,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody<Record<string, unknown>>(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const normalizedHostname = normalizeToHostname(hostname);

  try {
    const existing = await deps.repos.sites.findByBaseUrl(normalizedHostname);

    if (existing) {
      // Update existing
      const updates: Record<string, unknown> = {};
      if (typeof body.name === "string") updates.name = body.name;
      if (typeof body.baseUrl === "string") updates.baseUrl = normalizeToHostname(body.baseUrl);
      if (body.clearCache === true) updates.elementCache = "[]";
      await deps.repos.sites.update(existing.id, updates as any);
      const updated = await deps.repos.sites.findById(existing.id);
      sendJson(res, 200, { success: true, site: updated });
    } else {
      // Create new
      const site = await deps.repos.sites.create({
        name: (body.name as string) ?? normalizedHostname,
        baseUrl: normalizedHostname,
      });
      sendJson(res, 201, { success: true, site });
    }
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
  deps: SiteRouteDeps,
): Promise<void> {
  const normalizedHostname = normalizeToHostname(hostname);
  const site = await deps.repos.sites.findByBaseUrl(normalizedHostname);
  if (!site) {
    sendJson(res, 404, { error: `No site profile found for "${normalizedHostname}"` });
    return;
  }
  // Delete cognition data first (via siteId)
  await deps.repos.cognition.clearAllBySite(site.id);
  // Then delete the site profile
  await deps.repos.sites.delete(site.id);
  sendJson(res, 200, { success: true, message: `Site profile "${normalizedHostname}" and all related cognition data deleted` });
}

/** GET /api/v1/sites/:id/cognition — get cognition data for a site */
async function handleGetCognition(
  _req: IncomingMessage,
  res: ServerResponse,
  hostname: string,
  deps: SiteRouteDeps,
): Promise<void> {
  const normalizedHostname = normalizeToHostname(hostname);
  const site = await deps.repos.sites.findByBaseUrl(normalizedHostname);
  if (!site) {
    sendJson(res, 404, { error: `No site profile found for "${normalizedHostname}"` });
    return;
  }

  const [episodes, knowledge, procedures, patterns] = await Promise.all([
    deps.repos.cognition.listEpisodesBySite(site.id),
    deps.repos.cognition.listKnowledgeBySite(site.id),
    deps.repos.cognition.listProceduresBySite(site.id),
    deps.repos.cognition.listPatternsBySite(site.id),
  ]);

  sendJson(res, 200, {
    siteId: site.id,
    siteName: site.name,
    cognition: {
      episodes: episodes.length,
      knowledge: knowledge.length,
      procedures: procedures.length,
      patterns: patterns.length,
      recentEpisodes: episodes.slice(0, 10).map((e) => ({
        id: e.id,
        type: e.type,
        outcome: e.outcome,
        description: e.description,
        timestamp: e.timestamp,
      })),
      recentKnowledge: knowledge.slice(0, 10).map((k) => ({
        id: k.id,
        type: k.type,
        title: k.title,
        confidence: k.confidence,
      })),
    },
  });
}

/** DELETE /api/v1/sites/:id/cognition — clear cognition data for a site */
async function handleClearCognition(
  _req: IncomingMessage,
  res: ServerResponse,
  hostname: string,
  deps: SiteRouteDeps,
): Promise<void> {
  const normalizedHostname = normalizeToHostname(hostname);
  const site = await deps.repos.sites.findByBaseUrl(normalizedHostname);
  if (!site) {
    sendJson(res, 404, { error: `No site profile found for "${normalizedHostname}"` });
    return;
  }

  await deps.repos.cognition.clearAllBySite(site.id);
  sendJson(res, 200, { success: true, message: `Cognition data cleared for "${normalizedHostname}"` });
}

/** POST /api/v1/sites/:id/cognition/feedback — flag knowledge as inaccurate */
async function handleFlagKnowledge(
  req: IncomingMessage,
  res: ServerResponse,
  _hostname: string,
  deps: SiteRouteDeps,
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

  const knowledge = await deps.repos.cognition.getKnowledge(knowledgeId as string);
  if (!knowledge) {
    sendJson(res, 404, { error: "Knowledge not found" });
    return;
  }

  // Weaken the knowledge confidence
  const newConfidence = Math.max(0, knowledge.confidence - 0.3);
  await deps.repos.cognition.updateKnowledge(knowledgeId as string, {
    confidence: newConfidence,
    lastUsed: nowIso(),
  });

  sendJson(res, 200, { success: true, message: `Knowledge flagged as inaccurate (confidence: ${knowledge.confidence} → ${newConfidence})` });
}

/** POST /api/v1/sites/:id/cognition/manual — add manual experience */
async function handleAddManualExperience(
  req: IncomingMessage,
  res: ServerResponse,
  hostname: string,
  deps: SiteRouteDeps,
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

  // Normalize hostname and ensure site exists
  const normalizedHostname = normalizeToHostname(hostname);
  const site = await ensureSiteProfile(deps.repos, normalizedHostname);

  const episode = await deps.repos.cognition.createEpisode({
    siteId: site.id,
    sessionId: null,
    type: type as string,
    outcome: outcome as string,
    description: description as string,
    data: JSON.stringify({ findings, source: "manual", timestamp: Date.now() }),
    timestamp: Date.now(),
  });

  sendJson(res, 201, { success: true, episodeId: episode.id, message: "Manual experience added" });
}

/** POST /api/v1/sites/:id/cognition/:knowledgeId/weight — adjust knowledge weight */
async function handleAdjustWeight(
  req: IncomingMessage,
  res: ServerResponse,
  _hostname: string,
  knowledgeId: string,
  deps: SiteRouteDeps,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody<Record<string, unknown>>(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const { factor } = body;
  if (typeof factor !== "number") {
    sendJson(res, 400, { error: "Missing or invalid factor (must be a number)" });
    return;
  }

  const knowledge = await deps.repos.cognition.getKnowledge(knowledgeId);
  if (!knowledge) {
    sendJson(res, 404, { error: "Knowledge not found" });
    return;
  }

  const newConfidence = Math.min(1, Math.max(0, knowledge.confidence + factor));
  await deps.repos.cognition.updateKnowledge(knowledgeId, {
    confidence: newConfidence,
    lastUsed: nowIso(),
  });

  sendJson(res, 200, { success: true, message: `Knowledge weight adjusted (confidence: ${knowledge.confidence} → ${newConfidence})` });
}

// ── Route Dispatcher ──

/** Route dispatcher for site profile endpoints */
export async function dispatchSiteRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SiteRouteDeps,
  pathname: string,
): Promise<boolean> {
  // GET /api/v1/sites
  if (req.method === "GET" && pathname === "/api/v1/sites") {
    await handleListSites(req, res, deps);
    return true;
  }

  // POST /api/v1/sites/:id/cognition/feedback
  const feedbackMatch = matchRoute("/api/v1/sites/:id/cognition/feedback", pathname);
  if (feedbackMatch && req.method === "POST") {
    await handleFlagKnowledge(req, res, feedbackMatch.id!, deps);
    return true;
  }

  // POST /api/v1/sites/:id/cognition/manual
  const manualMatch = matchRoute("/api/v1/sites/:id/cognition/manual", pathname);
  if (manualMatch && req.method === "POST") {
    await handleAddManualExperience(req, res, manualMatch.id!, deps);
    return true;
  }

  // POST /api/v1/sites/:id/cognition/:knowledgeId/weight
  const weightMatch = matchRoute("/api/v1/sites/:id/cognition/:knowledgeId/weight", pathname);
  if (weightMatch && req.method === "POST") {
    await handleAdjustWeight(req, res, weightMatch.id!, weightMatch.knowledgeId!, deps);
    return true;
  }

  // GET /api/v1/sites/:id/cognition
  const getCogMatch = matchRoute("/api/v1/sites/:id/cognition", pathname);
  if (getCogMatch && req.method === "GET") {
    await handleGetCognition(req, res, getCogMatch.id!, deps);
    return true;
  }

  // DELETE /api/v1/sites/:id/cognition
  const delCogMatch = matchRoute("/api/v1/sites/:id/cognition", pathname);
  if (delCogMatch && req.method === "DELETE") {
    await handleClearCognition(req, res, delCogMatch.id!, deps);
    return true;
  }

  // GET /api/v1/sites/:id
  const getMatch = matchRoute("/api/v1/sites/:id", pathname);
  if (getMatch && req.method === "GET") {
    await handleGetSite(req, res, getMatch.id!, deps);
    return true;
  }

  // PUT /api/v1/sites/:id
  const putMatch = matchRoute("/api/v1/sites/:id", pathname);
  if (putMatch && req.method === "PUT") {
    await handleUpdateSite(req, res, putMatch.id!, deps);
    return true;
  }

  // DELETE /api/v1/sites/:id
  const delMatch = matchRoute("/api/v1/sites/:id", pathname);
  if (delMatch && req.method === "DELETE") {
    await handleDeleteSite(req, res, delMatch.id!, deps);
    return true;
  }

  return false;
}
