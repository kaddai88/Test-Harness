/**
 * In-memory repository implementations — no native dependencies.
 *
 * Stores everything in Maps. Data is lost when the process exits.
 * Perfect for development, testing, and demo mode.
 */
import type {
  SessionRepository,
  CreateSessionInput,
  SessionFilter,
  ReportRepository,
  CreateReportInput,
  SiteProfileRepository,
  CreateSiteProfileInput,
  CognitionRepository,
} from "../repositories/interfaces.js";
import type { SessionRow, ReportRow, SiteProfileRow, CognitionEpisodeRow, CognitionKnowledgeRow, CognitionProcedureRow, CognitionPatternRow } from "../schema.js";

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }
  );
}

function now(): string {
  return new Date().toISOString();
}

// ── In-memory Session Repository ──

export class InMemorySessionRepository implements SessionRepository {
  private store = new Map<string, SessionRow>();

  async create(input: CreateSessionInput): Promise<SessionRow> {
    const row: SessionRow = {
      id: input.id ?? uuid(),
      targetUrl: input.targetUrl,
      targetConfig: input.targetConfig,
      scanConfig: input.scanConfig,
      status: "pending",
      createdAt: now(),
      startedAt: null,
      completedAt: null,
      createdBy: input.createdBy ?? null,
      metadata: input.metadata ?? {},
    };
    this.store.set(row.id, row);
    return { ...row };
  }

  async findById(id: string): Promise<SessionRow | null> {
    const row = this.store.get(id);
    return row ? { ...row } : null;
  }

  async findAll(filter?: SessionFilter): Promise<SessionRow[]> {
    let rows = Array.from(this.store.values());
    if (filter?.status) {
      rows = rows.filter((r) => r.status === filter.status);
    }
    const dir = filter?.orderDir === "asc" ? 1 : -1;
    const key = filter?.orderBy === "status" ? "status" : "createdAt";
    rows.sort((a, b) => dir * (a[key] as string).localeCompare(b[key] as string));
    if (filter?.offset) rows = rows.slice(filter.offset);
    if (filter?.limit) rows = rows.slice(0, filter.limit);
    return rows.map((r) => ({ ...r }));
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const row = this.store.get(id);
    if (row) row.status = status;
  }

  async updateStartedAt(id: string): Promise<void> {
    const row = this.store.get(id);
    if (row) row.startedAt = now();
  }

  async updateCompletedAt(id: string): Promise<void> {
    const row = this.store.get(id);
    if (row) row.completedAt = now();
  }

  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    const row = this.store.get(id);
    if (row) {
      row.metadata = { ...row.metadata, ...metadata };
    }
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async count(filter?: SessionFilter): Promise<number> {
    if (!filter?.status) return this.store.size;
    let count = 0;
    this.store.forEach((r) => { if (r.status === filter.status) count++; });
    return count;
  }
}

// ── In-memory Report Repository ──

export class InMemoryReportRepository implements ReportRepository {
  private store = new Map<string, ReportRow>();

  async create(input: CreateReportInput): Promise<ReportRow> {
    const row: ReportRow = {
      id: input.id ?? uuid(),
      sessionId: input.sessionId,
      format: input.format,
      content: input.content ?? null,
      data: input.data ?? {},
      createdAt: now(),
    };
    this.store.set(row.id, row);
    return { ...row };
  }

  async findBySessionId(sessionId: string): Promise<ReportRow[]> {
    return Array.from(this.store.values())
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({ ...r }));
  }

  async findBySessionIdAndFormat(sessionId: string, format: string): Promise<ReportRow | null> {
    for (const row of this.store.values()) {
      if (row.sessionId === sessionId && row.format === format) return { ...row };
    }
    return null;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

// ── In-memory Site Profile Repository ──

export class InMemorySiteProfileRepository implements SiteProfileRepository {
  private store = new Map<string, SiteProfileRow>();

  async findAll(): Promise<SiteProfileRow[]> {
    return Array.from(this.store.values()).map((r) => ({ ...r }));
  }

  async findById(id: string): Promise<SiteProfileRow | null> {
    const row = this.store.get(id);
    return row ? { ...row } : null;
  }

  async findByBaseUrl(baseUrl: string): Promise<SiteProfileRow | null> {
    for (const row of this.store.values()) {
      if (row.baseUrl === baseUrl) return { ...row };
    }
    return null;
  }

  async create(input: CreateSiteProfileInput): Promise<SiteProfileRow> {
    const row: SiteProfileRow = {
      id: input.id ?? uuid(),
      name: input.name,
      baseUrl: input.baseUrl,
      elementCache: JSON.stringify(input.elementCache ?? []),
      updatedAt: now(),
    };
    this.store.set(row.id, row);
    return { ...row };
  }

  async update(id: string, data: Partial<Pick<SiteProfileRow, 'name' | 'baseUrl' | 'elementCache'>>): Promise<void> {
    const row = this.store.get(id);
    if (row) {
      if (data.name !== undefined) row.name = data.name;
      if (data.baseUrl !== undefined) row.baseUrl = data.baseUrl;
      if (data.elementCache !== undefined) row.elementCache = data.elementCache;
      row.updatedAt = now();
    }
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

// ── In-memory Cognition Repository ──

export class InMemoryCognitionRepository implements CognitionRepository {
  private episodes = new Map<string, CognitionEpisodeRow>();
  private knowledge = new Map<string, CognitionKnowledgeRow>();
  private procedures = new Map<string, CognitionProcedureRow>();
  private patterns = new Map<string, CognitionPatternRow>();

  async listEpisodes(targetUrl?: string): Promise<CognitionEpisodeRow[]> {
    const rows = Array.from(this.episodes.values());
    if (targetUrl) return rows.filter((r) => r.targetUrl.includes(targetUrl)).sort((a, b) => b.timestamp - a.timestamp);
    return rows.sort((a, b) => b.timestamp - a.timestamp);
  }
  async createEpisode(episode: Omit<CognitionEpisodeRow, 'id'>): Promise<CognitionEpisodeRow> {
    const row: CognitionEpisodeRow = { id: uuid(), ...episode };
    this.episodes.set(row.id, row);
    return { ...row };
  }
  async deleteEpisodesByTargetUrl(targetUrl: string): Promise<void> {
    for (const [id, row] of this.episodes) { if (row.targetUrl.includes(targetUrl)) this.episodes.delete(id); }
  }
  async countEpisodes(targetUrl?: string): Promise<number> {
    if (!targetUrl) return this.episodes.size;
    return Array.from(this.episodes.values()).filter((r) => r.targetUrl.includes(targetUrl)).length;
  }

  async listKnowledge(targetUrl?: string): Promise<CognitionKnowledgeRow[]> {
    const rows = Array.from(this.knowledge.values());
    if (targetUrl) return rows.filter((r) => !r.targetUrl || r.targetUrl.includes(targetUrl));
    return rows;
  }
  async getKnowledge(id: string): Promise<CognitionKnowledgeRow | null> {
    const row = this.knowledge.get(id);
    return row ? { ...row } : null;
  }
  async createKnowledge(k: Omit<CognitionKnowledgeRow, 'id' | 'useCount' | 'lastUsed' | 'createdAt'>): Promise<CognitionKnowledgeRow> {
    const row: CognitionKnowledgeRow = { id: uuid(), ...k, useCount: 0, lastUsed: null, createdAt: now() };
    this.knowledge.set(row.id, row);
    return { ...row };
  }
  async updateKnowledge(id: string, data: Partial<Pick<CognitionKnowledgeRow, 'confidence' | 'useCount' | 'lastUsed'>>): Promise<void> {
    const row = this.knowledge.get(id);
    if (row) { Object.assign(row, data); }
  }
  async deleteKnowledge(id: string): Promise<void> { this.knowledge.delete(id); }
  async deleteKnowledgeByTargetUrl(targetUrl: string): Promise<void> {
    for (const [id, row] of this.knowledge) { if (row.targetUrl?.includes(targetUrl)) this.knowledge.delete(id); }
  }
  async countKnowledge(targetUrl?: string): Promise<number> {
    if (!targetUrl) return this.knowledge.size;
    return Array.from(this.knowledge.values()).filter((r) => !r.targetUrl || r.targetUrl.includes(targetUrl)).length;
  }

  async listProcedures(targetUrl?: string): Promise<CognitionProcedureRow[]> {
    const rows = Array.from(this.procedures.values());
    if (targetUrl) return rows.filter((r) => !r.targetUrl || r.targetUrl.includes(targetUrl));
    return rows;
  }
  async createProcedure(p: Omit<CognitionProcedureRow, 'id' | 'useCount' | 'lastUsed'>): Promise<CognitionProcedureRow> {
    const row: CognitionProcedureRow = { id: uuid(), ...p, useCount: 0, lastUsed: null };
    this.procedures.set(row.id, row);
    return { ...row };
  }
  async updateProcedure(id: string, data: Partial<Pick<CognitionProcedureRow, 'successRate' | 'useCount' | 'lastUsed' | 'steps'>>): Promise<void> {
    const row = this.procedures.get(id);
    if (row) { Object.assign(row, data); }
  }
  async deleteProceduresByTargetUrl(targetUrl: string): Promise<void> {
    for (const [id, row] of this.procedures) { if (row.targetUrl?.includes(targetUrl)) this.procedures.delete(id); }
  }
  async countProcedures(targetUrl?: string): Promise<number> {
    if (!targetUrl) return this.procedures.size;
    return Array.from(this.procedures.values()).filter((r) => !r.targetUrl || r.targetUrl.includes(targetUrl)).length;
  }

  async listPatterns(targetUrl?: string): Promise<CognitionPatternRow[]> {
    const rows = Array.from(this.patterns.values());
    if (targetUrl) return rows.filter((r) => !r.targetUrl || r.targetUrl.includes(targetUrl));
    return rows;
  }
  async createPattern(p: Omit<CognitionPatternRow, 'id' | 'lastSeen'>): Promise<CognitionPatternRow> {
    const row: CognitionPatternRow = { id: uuid(), ...p, lastSeen: null };
    this.patterns.set(row.id, row);
    return { ...row };
  }
  async updatePattern(id: string, data: Partial<Pick<CognitionPatternRow, 'frequency' | 'confidence' | 'lastSeen'>>): Promise<void> {
    const row = this.patterns.get(id);
    if (row) { Object.assign(row, data); }
  }
  async deletePatternsByTargetUrl(targetUrl: string): Promise<void> {
    for (const [id, row] of this.patterns) { if (row.targetUrl?.includes(targetUrl)) this.patterns.delete(id); }
  }
  async countPatterns(targetUrl?: string): Promise<number> {
    if (!targetUrl) return this.patterns.size;
    return Array.from(this.patterns.values()).filter((r) => !r.targetUrl || r.targetUrl.includes(targetUrl)).length;
  }

  async clearAll(targetUrl?: string): Promise<void> {
    if (!targetUrl) {
      this.episodes.clear();
      this.knowledge.clear();
      this.procedures.clear();
      this.patterns.clear();
    } else {
      await this.deleteEpisodesByTargetUrl(targetUrl);
      await this.deleteKnowledgeByTargetUrl(targetUrl);
      await this.deleteProceduresByTargetUrl(targetUrl);
      await this.deletePatternsByTargetUrl(targetUrl);
    }
  }
}
