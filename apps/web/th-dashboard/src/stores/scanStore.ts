import { create } from 'zustand';
import { api } from '../api/client';
import { scanWebSocket } from '../api/websocket';
import type { Scan, Finding, DetectionProgress, AgentActivity } from '../types';

interface ScanStore {
  scans: Scan[];
  currentScan: Scan | null;
  findings: Finding[];
  detections: DetectionProgress[];
  agentActivity: AgentActivity[];
  loading: boolean;
  error: string | null;
  totalScans: number;
  currentPage: number;
  pageSize: number;
  statusFilter: string;

  fetchScans: () => Promise<void>;
  fetchScan: (id: string) => Promise<void>;
  createScan: (url: string, scope: string, strategy: string, categories: string[], instructions?: string) => Promise<string>;
  cancelScan: (id: string) => Promise<void>;
  setPage: (page: number) => void;
  setStatusFilter: (status: string) => void;
  clearError: () => void;
  connectWebSocket: () => () => void;
}

export const useScanStore = create<ScanStore>((set, get) => ({
  scans: [],
  currentScan: null,
  findings: [],
  detections: [],
  agentActivity: [],
  loading: false,
  error: null,
  totalScans: 0,
  currentPage: 1,
  pageSize: 20,
  statusFilter: 'all',

  fetchScans: async () => {
    set({ loading: true, error: null });
    try {
      const { currentPage, pageSize, statusFilter } = get();
      const result = await api.getScans(currentPage, pageSize, statusFilter);
      set({
        scans: result.scans ?? result.items ?? [],
        totalScans: result.total ?? 0,
        loading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch scans',
        loading: false,
      });
    }
  },

  fetchScan: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const scan = await api.getScan(id);
      set({
        currentScan: scan,
        loading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch scan',
        loading: false,
      });
    }
  },

  createScan: async (url, scope, strategy, categories, instructions?: string) => {
    set({ loading: true, error: null });
    try {
      const result = await api.createScan({
        targetUrl: url,
        scope: scope as 'page' | 'site' | 'domain',
        strategy: strategy as 'sequential' | 'parallel' | 'adaptive',
        categories: categories as ('security' | 'performance' | 'functionality' | 'seo' | 'accessibility')[],
        instructions,
      });
      set({ loading: false });
      return result.id;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to create scan',
        loading: false,
      });
      throw error;
    }
  },

  cancelScan: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await api.cancelScan(id);
      const { currentScan } = get();
      if (currentScan && currentScan.id === id) {
        set({ currentScan: { ...currentScan, status: 'cancelled' } });
      }
      set({ loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to cancel scan',
        loading: false,
      });
    }
  },

  setPage: (page: number) => {
    set({ currentPage: page });
    get().fetchScans();
  },

  setStatusFilter: (status: string) => {
    set({ statusFilter: status, currentPage: 1 });
    get().fetchScans();
  },

  clearError: () => set({ error: null }),

  connectWebSocket: () => {
    scanWebSocket.connect();

    const unsubs = [
      scanWebSocket.onScanUpdate((scan) => {
        const { currentScan, scans } = get();
        if (currentScan && currentScan.id === scan.id) {
          set({ currentScan: scan });
        }
        set({
          scans: scans.map((s) => (s.id === scan.id ? scan : s)),
        });
      }),

      scanWebSocket.onFinding((finding) => {
        set((state) => ({
          findings: [finding, ...state.findings],
        }));
      }),

      scanWebSocket.onDetectionUpdate((detection) => {
        set((state) => ({
          detections: state.detections.map((d) =>
            d.id === detection.id ? detection : d
          ),
        }));
      }),

      scanWebSocket.onAgentActivity((activity) => {
        set((state) => ({
          agentActivity: [...state.agentActivity, activity],
        }));
      }),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
      scanWebSocket.disconnect();
    };
  },
}));
