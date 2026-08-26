export type ScanStatus = 'pending' | 'planning' | 'executing' | 'running' | 'crawling' | 'analyzing' | 'completed' | 'failed' | 'cancelled';
export type ScanScope = 'page' | 'site' | 'domain';
export type DetectionCategory = 'security' | 'performance' | 'functionality' | 'seo' | 'accessibility';
export type ScanStrategy = 'sequential' | 'parallel' | 'adaptive';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Scan {
  id: string;
  targetUrl: string;
  url?: string;
  targetConfig?: Record<string, unknown>;
  scanConfig?: Record<string, unknown>;
  status: ScanStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdBy?: string | null;
  metadata?: Record<string, unknown>;
  score?: number;
  findings?: Finding[];
  detections?: DetectionProgress[];
  progress?: number;
  phase?: string;
}

export interface Finding {
  id: string;
  sessionId?: string;
  scanId?: string;
  category?: DetectionCategory;
  severity: Severity;
  title: string;
  description: string;
  recommendation?: string;
  url?: string;
  evidence?: {
    selector?: string;
    screenshot?: string;
    url?: string;
    html?: string;
  };
  createdAt: string;
}

export interface DetectionProgress {
  id: string;
  scanId: string;
  category: DetectionCategory;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  progress: number;
  findingsCount: number;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AgentActivity {
  id: string;
  scanId?: string;
  turn: number;
  kind: 'turn_started' | 'stream' | 'tool_call' | 'tool_result';
  tool?: string;
  input?: Record<string, unknown>;
  success?: boolean;
  /** Partial streamed text (kind: "stream") */
  partial?: string;
  done?: boolean;
  timestamp: number;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime: number;
  activeScans: number;
}

export interface ScanCreateRequest {
  targetUrl: string;
  url?: string;
  scope: ScanScope;
  strategy: ScanStrategy;
  categories?: DetectionCategory[];
  instructions?: string;
  maxTurns?: number;
  timeout?: number;
}

export interface ScanCreateResponse {
  id: string;
  status: ScanStatus;
}

export interface DashboardStats {
  totalScans: number;
  activeScans: number;
  averageScore: number;
  totalFindings: number;
}

export interface PaginatedResponse<T> {
  scans: T[];
  items?: T[];
  total: number;
  limit?: number;
  offset?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
}
