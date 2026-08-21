export type ScanStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ScanScope = 'page' | 'site' | 'domain';
export type DetectionCategory = 'security' | 'performance' | 'seo' | 'accessibility';
export type ScanStrategy = 'sequential' | 'parallel' | 'adaptive';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Scan {
  id: string;
  url: string;
  status: ScanStatus;
  scope: ScanScope;
  strategy: ScanStrategy;
  categories: DetectionCategory[];
  score: number | null;
  findings: Finding[];
  detections: DetectionProgress[];
  progress: number;
  phase: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  duration: number | null;
  maxTurns: number;
  timeout: number;
}

export interface Finding {
  id: string;
  scanId: string;
  category: DetectionCategory;
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
  url?: string;
  evidence?: string;
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
  scanId: string;
  turn: number;
  action: string;
  tool?: string;
  input?: string;
  output?: string;
  timestamp: string;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime: number;
  activeScans: number;
}

export interface ScanCreateRequest {
  url: string;
  scope: ScanScope;
  strategy: ScanStrategy;
  categories: DetectionCategory[];
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
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
