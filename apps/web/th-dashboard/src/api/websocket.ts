import type { Finding, AgentActivity } from '../types';

type EventHandler = (data: unknown) => void;

export class ScanWebSocket {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, EventHandler[]>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.emit('connected', { connected: true });
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string);
          // Server sends flat messages (no `payload` wrapper) — emit entire message
          this.emit(message.type, message);
        } catch {
          console.warn('Failed to parse WebSocket message:', event.data);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.emit('error', { error: 'WebSocket connection error' });
      };

      this.ws.onclose = () => {
        this.emit('disconnected', { connected: false });
        this.scheduleReconnect();
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  on(event: string, handler: EventHandler): void {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(handler);
    this.listeners.set(event, handlers);
  }

  off(event: string, handler: EventHandler): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    this.listeners.set(
      event,
      handlers.filter((h) => h !== handler)
    );
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.listeners.clear();
  }

  /** scan:update — status change notification */
  onScanUpdate(
    handler: (data: { sessionId: string; status: string }) => void
  ): () => void {
    const wrapped = (data: unknown) => {
      const msg = data as { sessionId?: string; status?: string };
      if (msg.sessionId && msg.status) handler({ sessionId: msg.sessionId, status: msg.status });
    };
    this.on('scan:update', wrapped);
    return () => this.off('scan:update', wrapped);
  }

  /** scan:finding — batch of findings from completed session */
  onFinding(handler: (findings: Finding[]) => void): () => void {
    const wrapped = (data: unknown) => {
      const msg = data as { findings?: Finding[] };
      if (msg.findings) handler(msg.findings);
    };
    this.on('scan:finding', wrapped);
    return () => this.off('scan:finding', wrapped);
  }

  /** agent:activity — real-time step from the agent loop */
  onAgentActivity(handler: (activity: AgentActivity) => void): () => void {
    const wrapped = (data: unknown) => {
      const msg = data as Record<string, unknown>;
      // Build AgentActivity from flat server message
      const activity: AgentActivity = {
        id: `act_${msg.timestamp ?? Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        scanId: msg.sessionId as string | undefined,
        turn: (msg.turn as number) ?? 0,
        kind: (msg.kind as AgentActivity['kind']) ?? 'turn_started',
        tool: msg.tool as string | undefined,
        input: msg.input as Record<string, unknown> | undefined,
        success: msg.success as boolean | undefined,
        partial: msg.partial as string | undefined,
        done: msg.done as boolean | undefined,
        timestamp: msg.timestamp as number ?? Date.now(),
      };
      handler(activity);
    };
    this.on('agent:activity', wrapped);
    return () => this.off('agent:activity', wrapped);
  }

  /** session:status — phase transition (planning → executing → etc.) */
  onSessionStatus(
    handler: (data: { sessionId: string; status: string; message?: string }) => void
  ): () => void {
    const wrapped = (data: unknown) => {
      const msg = data as { sessionId?: string; status?: string; message?: string };
      if (msg.sessionId && msg.status) {
        handler({ sessionId: msg.sessionId, status: msg.status, message: msg.message });
      }
    };
    this.on('session:status', wrapped);
    return () => this.off('session:status', wrapped);
  }

  /** session:completed — final summary */
  onSessionCompleted(
    handler: (data: { sessionId: string; status: string; summary?: string; findingCount?: number }) => void
  ): () => void {
    const wrapped = (data: unknown) => {
      const msg = data as { sessionId?: string; status?: string; summary?: string; findingCount?: number };
      if (msg.sessionId && msg.status) {
        handler({ sessionId: msg.sessionId, status: msg.status, summary: msg.summary, findingCount: msg.findingCount });
      }
    };
    this.on('session:completed', wrapped);
    return () => this.off('session:completed', wrapped);
  }

  private emit(event: string, data: unknown): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in ${event} handler:`, error);
        }
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    if (this.reconnectTimer) return;

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

export const scanWebSocket = new ScanWebSocket();
