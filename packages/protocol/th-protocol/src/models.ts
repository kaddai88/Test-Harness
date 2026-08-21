/**
 * Scan models — the core domain types for website scanning.
 */

/** Scan lifecycle status */
export type ScanStatus =
  | "pending"
  | "crawling"
  | "analyzing"
  | "completed"
  | "failed"
  | "cancelled";

/** Target scope: single page, entire site, or full domain */
export type TargetScope = "page" | "site" | "domain";

/** Authentication method for protected targets */
export interface TargetAuth {
  type: "cookie" | "header" | "basic";
  credentials: Record<string, string>;
}

/** Configuration for the scan target */
export interface TargetConfig {
  scope: TargetScope;
  auth?: TargetAuth;
  headers?: Record<string, string>;
  userAgent?: string;
}

/** Scan execution configuration */
export interface ScanConfig {
  /** Detection plugin IDs to run */
  detections: string[];
  /** Execution strategy */
  strategy: "sequential" | "parallel" | "adaptive";
  /** LLM configuration */
  llm: {
    provider: string;
    model: string;
    temperature?: number;
  };
  /** Crawl configuration */
  crawl: {
    maxDepth: number;
    maxPages: number;
    respectRobots: boolean;
    rateLimit: number;
  };
  /** Maximum agent loop turns */
  maxTurns: number;
  /** Scan timeout in milliseconds */
  timeout: number;
}

/** A scan target to inspect */
export interface ScanTarget {
  url: string;
  scope: TargetScope;
  pageData?: PageData;
}

/** Fetched page data available for detection */
export interface PageData {
  url: string;
  html: string;
  headers: Record<string, string>;
  status: number;
  dom?: DOMExtract;
  screenshot?: Buffer;
}

/** The scan entity */
export interface Scan {
  id: string;
  targetUrl: string;
  targetConfig: TargetConfig;
  scanConfig: ScanConfig;
  status: ScanStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  createdBy?: string;
  metadata: Record<string, unknown>;
}

/** Input to create a new scan */
export interface CreateScanInput {
  targetUrl: string;
  targetConfig?: Partial<TargetConfig>;
  scanConfig?: Partial<ScanConfig>;
  createdBy?: string;
}

/** DOM extraction result */
export interface DOMExtract {
  url: string;
  title: string;
  headings: Array<{ level: number; text: string }>;
  links: Array<{ href: string; text: string; rel: string }>;
  forms: Array<{ action: string; method: string; fields: FormField[] }>;
  images: Array<{ src: string; alt: string }>;
  scripts: Array<{ src?: string; inline: boolean }>;
  meta: Record<string, string>;
}

/** Form field descriptor */
export interface FormField {
  name: string;
  type: string;
  id?: string;
  required?: boolean;
}
