/**
 * JSON file-based database — simple persistent storage without native dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SessionRow, ReportRow, SiteProfileRow, CognitionEpisodeRow, CognitionKnowledgeRow, CognitionProcedureRow, CognitionPatternRow } from '../schema.js';
import type {
  SessionRepository,
  CreateSessionInput,
  SessionFilter,
  ReportRepository,
  CreateReportInput,
  SiteProfileRepository,
  CreateSiteProfileInput,
  CognitionRepository,
} from '../repositories/interfaces.js';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
    /[xy]/g,
    (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }
  );
}

function now(): string {
  return new Date().toISOString();
}

/** Ensure parent directory exists */
function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** JSON file database */
export class JsonFileDatabase {
  private filePath: string;
  private data: {
    sessions: Record<string, SessionRow>;
    reports: Record<string, ReportRow>;
    sites: Record<string, SiteProfileRow>;
    cognition_episodes: Record<string, CognitionEpisodeRow>;
    cognition_knowledge: Record<string, CognitionKnowledgeRow>;
    cognition_procedures: Record<string, CognitionProcedureRow>;
    cognition_patterns: Record<string, CognitionPatternRow>;
  };

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = {
      sessions: {},
      reports: {},
      sites: {},
      cognition_episodes: {},
      cognition_knowledge: {},
      cognition_procedures: {},
      cognition_patterns: {},
    };

    // Ensure parent directory exists
    ensureDir(filePath);

    // Load existing data
    if (fs.existsSync(filePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        // Backward compat: rename old `scans` key → `sessions`
        if (raw.scans && !raw.sessions) {
          raw.sessions = raw.scans;
          delete raw.scans;
        }
        // Drop legacy keys
        delete raw.detectionResults;
        delete raw.scanEvents;
        this.data = {
          sessions: raw.sessions ?? {},
          reports: raw.reports ?? {},
          sites: raw.sites ?? {},
          cognition_episodes: raw.cognition_episodes ?? {},
          cognition_knowledge: raw.cognition_knowledge ?? {},
          cognition_procedures: raw.cognition_procedures ?? {},
          cognition_patterns: raw.cognition_patterns ?? {},
        };
      } catch (err) {
        console.warn('[JsonDB] Failed to load existing data, starting fresh:', err);
      }
    }

    // Save periodically
    setInterval(() => this.save(), 5000);
  }

  save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('[JsonDB] Failed to save:', err);
    }
  }

  close(): void {
    this.save();
  }

  getData() {
    return this.data;
  }
}

// ── JSON File Session Repository ──

export class JsonFileSessionRepository implements SessionRepository {
  constructor(private db: JsonFileDatabase) {}

  async create(input: CreateSessionInput): Promise<SessionRow> {
    const id = input.id ?? uuid();
    const row: SessionRow = {
      id,
      targetUrl: input.targetUrl,
      targetConfig: input.targetConfig ?? {},
      scanConfig: input.scanConfig ?? {},
      status: 'pending',
      createdAt: now(),
      startedAt: null,
      completedAt: null,
      createdBy: input.createdBy ?? null,
      metadata: input.metadata ?? {},
    };
    this.db.getData().sessions[id] = row;
    this.db.save();
    return { ...row };
  }

  async findById(id: string): Promise<SessionRow | null> {
    const row = this.db.getData().sessions[id];
    return row ? { ...row } : null;
  }

  async findAll(filter?: SessionFilter): Promise<SessionRow[]> {
    let rows = Object.values(this.db.getData().sessions);
    if (filter?.status) {
      rows = rows.filter((r) => r.status === filter.status);
    }
    const dir = filter?.orderDir === 'asc' ? 1 : -1;
    const key = filter?.orderBy === 'status' ? 'status' : 'createdAt';
    rows.sort((a, b) => dir * (a[key] as string).localeCompare(b[key] as string));
    if (filter?.offset) rows = rows.slice(filter.offset);
    if (filter?.limit) rows = rows.slice(0, filter.limit);
    return rows.map((r) => ({ ...r }));
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const row = this.db.getData().sessions[id];
    if (row) {
      row.status = status;
      this.db.save();
    }
  }

  async updateStartedAt(id: string): Promise<void> {
    const row = this.db.getData().sessions[id];
    if (row) {
      row.startedAt = now();
      this.db.save();
    }
  }

  async updateCompletedAt(id: string): Promise<void> {
    const row = this.db.getData().sessions[id];
    if (row) {
      row.completedAt = now();
      this.db.save();
    }
  }

  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    const row = this.db.getData().sessions[id];
    if (row) {
      row.metadata = { ...row.metadata, ...metadata };
      this.db.save();
    }
  }

  async delete(id: string): Promise<void> {
    delete this.db.getData().sessions[id];
    this.db.save();
  }

  async count(filter?: SessionFilter): Promise<number> {
    const rows = Object.values(this.db.getData().sessions);
    if (filter?.status) {
      return rows.filter((r) => r.status === filter.status).length;
    }
    return rows.length;
  }
}

// ── JSON File Report Repository ──

export class JsonFileReportRepository implements ReportRepository {
  constructor(private db: JsonFileDatabase) {}

  async create(input: CreateReportInput): Promise<ReportRow> {
    const id = input.id ?? uuid();
    const row: ReportRow = {
      id,
      sessionId: input.sessionId,
      format: input.format,
      content: input.content ?? null,
      data: input.data ?? {},
      createdAt: now(),
    };
    this.db.getData().reports[id] = row;
    this.db.save();
    return { ...row };
  }

  async findBySessionId(sessionId: string): Promise<ReportRow[]> {
    return Object.values(this.db.getData().reports)
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findBySessionIdAndFormat(sessionId: string, format: string): Promise<ReportRow | null> {
    const row = Object.values(this.db.getData().reports).find(
      (r) => r.sessionId === sessionId && r.format === format
    );
    return row ? { ...row } : null;
  }

  async delete(id: string): Promise<void> {
    delete this.db.getData().reports[id];
    this.db.save();
  }
}

// ── JSON File Site Profile Repository ──

export class JsonFileSiteProfileRepository implements SiteProfileRepository {
  constructor(private db: JsonFileDatabase) {}

  async findAll(): Promise<SiteProfileRow[]> {
    return Object.values(this.db.getData().sites).map((r) => ({ ...r }));
  }

  async findById(id: string): Promise<SiteProfileRow | null> {
    const row = this.db.getData().sites[id];
    return row ? { ...row } : null;
  }

  async findByBaseUrl(baseUrl: string): Promise<SiteProfileRow | null> {
    const row = Object.values(this.db.getData().sites).find(
      (r) => r.baseUrl === baseUrl
    );
    return row ? { ...row } : null;
  }

  async create(input: CreateSiteProfileInput): Promise<SiteProfileRow> {
    const id = input.id ?? uuid();
    const row: SiteProfileRow = {
      id,
      name: input.name,
      baseUrl: input.baseUrl,
      elementCache: JSON.stringify(input.elementCache ?? []),
      updatedAt: now(),
    };
    this.db.getData().sites[id] = row;
    this.db.save();
    return { ...row };
  }

  async update(id: string, data: Partial<Pick<SiteProfileRow, 'name' | 'baseUrl' | 'elementCache'>>): Promise<void> {
    const row = this.db.getData().sites[id];
    if (row) {
      if (data.name !== undefined) row.name = data.name;
      if (data.baseUrl !== undefined) row.baseUrl = data.baseUrl;
      if (data.elementCache !== undefined) row.elementCache = data.elementCache;
      row.updatedAt = now();
      this.db.save();
    }
  }

  async delete(id: string): Promise<void> {
    delete this.db.getData().sites[id];
    this.db.save();
  }
}

// ── JSON File Cognition Repository ──

export class JsonFileCognitionRepository implements CognitionRepository {
  constructor(private db: JsonFileDatabase) {}

  // Episodes
  async listEpisodes(targetUrl?: string): Promise<CognitionEpisodeRow[]> {
    const rows = Object.values(this.db.getData().cognition_episodes);
    if (targetUrl) return rows.filter((r) => r.targetUrl.includes(targetUrl)).sort((a, b) => b.timestamp - a.timestamp);
    return rows.sort((a, b) => b.timestamp - a.timestamp);
  }

  async createEpisode(episode: Omit<CognitionEpisodeRow, 'id'>): Promise<CognitionEpisodeRow> {
    const id = uuid();
    const row: CognitionEpisodeRow = { id, ...episode };
    this.db.getData().cognition_episodes[id] = row;
    this.db.save();
    return { ...row };
  }

  async deleteEpisodesByTargetUrl(targetUrl: string): Promise<void> {
    const data = this.db.getData().cognition_episodes;
    for (const [id, row] of Object.entries(data)) {
      if (row.targetUrl.includes(targetUrl)) delete data[id];
    }
    this.db.save();
  }

  async countEpisodes(targetUrl?: string): Promise<number> {
    const rows = Object.values(this.db.getData().cognition_episodes);
    if (targetUrl) return rows.filter((r) => r.targetUrl.includes(targetUrl)).length;
    return rows.length;
  }

  // Knowledge
  async listKnowledge(targetUrl?: string): Promise<CognitionKnowledgeRow[]> {
    const rows = Object.values(this.db.getData().cognition_knowledge);
    if (targetUrl) return rows.filter((r) => !r.targetUrl || r.targetUrl.includes(targetUrl)).sort((a, b) => b.confidence - a.confidence);
    return rows.sort((a, b) => b.confidence - a.confidence);
  }

  async getKnowledge(id: string): Promise<CognitionKnowledgeRow | null> {
    const row = this.db.getData().cognition_knowledge[id];
    return row ? { ...row } : null;
  }

  async createKnowledge(knowledge: Omit<CognitionKnowledgeRow, 'id' | 'useCount' | 'lastUsed' | 'createdAt'>): Promise<CognitionKnowledgeRow> {
    const id = uuid();
    const row: CognitionKnowledgeRow = {
      id,
      ...knowledge,
      useCount: 0,
      lastUsed: null,
      createdAt: now(),
    };
    this.db.getData().cognition_knowledge[id] = row;
    this.db.save();
    return { ...row };
  }

  async updateKnowledge(id: string, data: Partial<Pick<CognitionKnowledgeRow, 'confidence' | 'useCount' | 'lastUsed'>>): Promise<void> {
    const row = this.db.getData().cognition_knowledge[id];
    if (row) {
      if (data.confidence !== undefined) row.confidence = data.confidence;
      if (data.useCount !== undefined) row.useCount = data.useCount;
      if (data.lastUsed !== undefined) row.lastUsed = data.lastUsed;
      this.db.save();
    }
  }

  async deleteKnowledge(id: string): Promise<void> {
    delete this.db.getData().cognition_knowledge[id];
    this.db.save();
  }

  async deleteKnowledgeByTargetUrl(targetUrl: string): Promise<void> {
    const data = this.db.getData().cognition_knowledge;
    for (const [id, row] of Object.entries(data)) {
      if (row.targetUrl?.includes(targetUrl)) delete data[id];
    }
    this.db.save();
  }

  async countKnowledge(targetUrl?: string): Promise<number> {
    const rows = Object.values(this.db.getData().cognition_knowledge);
    if (targetUrl) return rows.filter((r) => !r.targetUrl || r.targetUrl.includes(targetUrl)).length;
    return rows.length;
  }

  // Procedures
  async listProcedures(targetUrl?: string): Promise<CognitionProcedureRow[]> {
    const rows = Object.values(this.db.getData().cognition_procedures);
    if (targetUrl) return rows.filter((r) => !r.targetUrl || r.targetUrl.includes(targetUrl));
    return rows;
  }

  async createProcedure(procedure: Omit<CognitionProcedureRow, 'id' | 'useCount' | 'lastUsed'>): Promise<CognitionProcedureRow> {
    const id = uuid();
    const row: CognitionProcedureRow = {
      id,
      ...procedure,
      useCount: 0,
      lastUsed: null,
    };
    this.db.getData().cognition_procedures[id] = row;
    this.db.save();
    return { ...row };
  }

  async updateProcedure(id: string, data: Partial<Pick<CognitionProcedureRow, 'successRate' | 'useCount' | 'lastUsed' | 'steps'>>): Promise<void> {
    const row = this.db.getData().cognition_procedures[id];
    if (row) {
      if (data.successRate !== undefined) row.successRate = data.successRate;
      if (data.useCount !== undefined) row.useCount = data.useCount;
      if (data.lastUsed !== undefined) row.lastUsed = data.lastUsed;
      if (data.steps !== undefined) row.steps = data.steps;
      this.db.save();
    }
  }

  async deleteProceduresByTargetUrl(targetUrl: string): Promise<void> {
    const data = this.db.getData().cognition_procedures;
    for (const [id, row] of Object.entries(data)) {
      if (row.targetUrl?.includes(targetUrl)) delete data[id];
    }
    this.db.save();
  }

  async countProcedures(targetUrl?: string): Promise<number> {
    const rows = Object.values(this.db.getData().cognition_procedures);
    if (targetUrl) return rows.filter((r) => !r.targetUrl || r.targetUrl.includes(targetUrl)).length;
    return rows.length;
  }

  // Patterns
  async listPatterns(targetUrl?: string): Promise<CognitionPatternRow[]> {
    const rows = Object.values(this.db.getData().cognition_patterns);
    if (targetUrl) return rows.filter((r) => !r.targetUrl || r.targetUrl.includes(targetUrl));
    return rows;
  }

  async createPattern(pattern: Omit<CognitionPatternRow, 'id' | 'lastSeen'>): Promise<CognitionPatternRow> {
    const id = uuid();
    const row: CognitionPatternRow = {
      id,
      ...pattern,
      lastSeen: null,
    };
    this.db.getData().cognition_patterns[id] = row;
    this.db.save();
    return { ...row };
  }

  async updatePattern(id: string, data: Partial<Pick<CognitionPatternRow, 'frequency' | 'confidence' | 'lastSeen'>>): Promise<void> {
    const row = this.db.getData().cognition_patterns[id];
    if (row) {
      if (data.frequency !== undefined) row.frequency = data.frequency;
      if (data.confidence !== undefined) row.confidence = data.confidence;
      if (data.lastSeen !== undefined) row.lastSeen = data.lastSeen;
      this.db.save();
    }
  }

  async deletePatternsByTargetUrl(targetUrl: string): Promise<void> {
    const data = this.db.getData().cognition_patterns;
    for (const [id, row] of Object.entries(data)) {
      if (row.targetUrl?.includes(targetUrl)) delete data[id];
    }
    this.db.save();
  }

  async countPatterns(targetUrl?: string): Promise<number> {
    const rows = Object.values(this.db.getData().cognition_patterns);
    if (targetUrl) return rows.filter((r) => !r.targetUrl || r.targetUrl.includes(targetUrl)).length;
    return rows.length;
  }

  // Bulk clear
  async clearAll(targetUrl?: string): Promise<void> {
    if (!targetUrl) {
      this.db.getData().cognition_episodes = {};
      this.db.getData().cognition_knowledge = {};
      this.db.getData().cognition_procedures = {};
      this.db.getData().cognition_patterns = {};
    } else {
      await this.deleteEpisodesByTargetUrl(targetUrl);
      await this.deleteKnowledgeByTargetUrl(targetUrl);
      await this.deleteProceduresByTargetUrl(targetUrl);
      await this.deletePatternsByTargetUrl(targetUrl);
    }
    this.db.save();
  }
}
