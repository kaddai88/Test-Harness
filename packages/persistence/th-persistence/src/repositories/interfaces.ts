/**
 * Repository interfaces — the data access abstraction layer.
 *
 * These interfaces are provider-neutral. Implementations exist for
 * both PostgreSQL (production) and SQLite (development).
 */
import type { SessionRow, ReportRow, SiteProfileRow, CognitionEpisodeRow, CognitionKnowledgeRow, CognitionProcedureRow, CognitionPatternRow } from "../schema.js";

// ── Session Repository ──

export interface CreateSessionInput {
  id?: string;
  targetUrl: string;
  targetConfig: Record<string, unknown>;
  scanConfig: Record<string, unknown>;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionFilter {
  status?: string;
  limit?: number;
  offset?: number;
  orderBy?: "created_at" | "status";
  orderDir?: "asc" | "desc";
}

export interface SessionRepository {
  create(input: CreateSessionInput): Promise<SessionRow>;
  findById(id: string): Promise<SessionRow | null>;
  findAll(filter?: SessionFilter): Promise<SessionRow[]>;
  updateStatus(id: string, status: string): Promise<void>;
  updateStartedAt(id: string): Promise<void>;
  updateCompletedAt(id: string): Promise<void>;
  updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void>;
  delete(id: string): Promise<void>;
  count(filter?: SessionFilter): Promise<number>;
}

// ── Report Repository ──

export interface CreateReportInput {
  id?: string;
  sessionId: string;
  format: string;
  content?: string;
  data?: Record<string, unknown>;
}

export interface ReportRepository {
  create(input: CreateReportInput): Promise<ReportRow>;
  findBySessionId(sessionId: string): Promise<ReportRow[]>;
  findBySessionIdAndFormat(sessionId: string, format: string): Promise<ReportRow | null>;
  delete(id: string): Promise<void>;
}

// ── Site Profile Repository ──

export interface CreateSiteProfileInput {
  id?: string;
  name: string;
  baseUrl: string;
  elementCache?: unknown[];
}

export interface SiteProfileRepository {
  findAll(): Promise<SiteProfileRow[]>;
  findById(id: string): Promise<SiteProfileRow | null>;
  findByBaseUrl(baseUrl: string): Promise<SiteProfileRow | null>;
  create(input: CreateSiteProfileInput): Promise<SiteProfileRow>;
  update(id: string, data: Partial<Pick<SiteProfileRow, 'name' | 'baseUrl' | 'elementCache'>>): Promise<void>;
  delete(id: string): Promise<void>;
}

// ── Cognition Repository ──

export interface CognitionRepository {
  // Episodes
  listEpisodes(targetUrl?: string): Promise<CognitionEpisodeRow[]>;
  createEpisode(episode: Omit<CognitionEpisodeRow, 'id'>): Promise<CognitionEpisodeRow>;
  deleteEpisodesByTargetUrl(targetUrl: string): Promise<void>;
  countEpisodes(targetUrl?: string): Promise<number>;

  // Knowledge
  listKnowledge(targetUrl?: string): Promise<CognitionKnowledgeRow[]>;
  getKnowledge(id: string): Promise<CognitionKnowledgeRow | null>;
  createKnowledge(knowledge: Omit<CognitionKnowledgeRow, 'id' | 'useCount' | 'lastUsed' | 'createdAt'>): Promise<CognitionKnowledgeRow>;
  updateKnowledge(id: string, data: Partial<Pick<CognitionKnowledgeRow, 'confidence' | 'useCount' | 'lastUsed'>>): Promise<void>;
  deleteKnowledge(id: string): Promise<void>;
  deleteKnowledgeByTargetUrl(targetUrl: string): Promise<void>;
  countKnowledge(targetUrl?: string): Promise<number>;

  // Procedures
  listProcedures(targetUrl?: string): Promise<CognitionProcedureRow[]>;
  createProcedure(procedure: Omit<CognitionProcedureRow, 'id' | 'useCount' | 'lastUsed'>): Promise<CognitionProcedureRow>;
  updateProcedure(id: string, data: Partial<Pick<CognitionProcedureRow, 'successRate' | 'useCount' | 'lastUsed' | 'steps'>>): Promise<void>;
  deleteProceduresByTargetUrl(targetUrl: string): Promise<void>;
  countProcedures(targetUrl?: string): Promise<number>;

  // Patterns
  listPatterns(targetUrl?: string): Promise<CognitionPatternRow[]>;
  createPattern(pattern: Omit<CognitionPatternRow, 'id' | 'lastSeen'>): Promise<CognitionPatternRow>;
  updatePattern(id: string, data: Partial<Pick<CognitionPatternRow, 'frequency' | 'confidence' | 'lastSeen'>>): Promise<void>;
  deletePatternsByTargetUrl(targetUrl: string): Promise<void>;
  countPatterns(targetUrl?: string): Promise<number>;

  // Bulk
  clearAll(targetUrl?: string): Promise<void>;
}
