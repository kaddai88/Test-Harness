import type { Scan, Finding, DetectionProgress, AgentActivity } from '../types';

type EventHandler = (data: unknown) => void;

interface WebSocketEvent {
  type: string;
  payload: unknown;
}

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
          const message = JSON.parse(event.data as string) as WebSocketEvent;
          this.emit(message.type, message.payload);
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

  onScanUpdate(handler: (scan: Scan) => void): () => void {
    const wrapped = (data: unknown) => handler(data as Scan);
    this.on('scan:update', wrapped);
    return () => this.off('scan:update', wrapped);
  }

  onFinding(handler: (finding: Finding) => void): () => void {
    const wrapped = (data: unknown) => handler(data as Finding);
    this.on('scan:finding', wrapped);
    return () => this.off('scan:finding', wrapped);
  }

  onDetectionUpdate(handler: (detection: DetectionProgress) => void): () => void {
    const wrapped = (data: unknown) => handler(data as DetectionProgress);
    this.on('detection:update', wrapped);
    return () => this.off('detection:update', wrapped);
  }

  onAgentActivity(handler: (activity: AgentActivity) => void): () => void {
    const wrapped = (data: unknown) => handler(data as AgentActivity);
    this.on('agent:activity', wrapped);
    return () => this.off('agent:activity', wrapped);
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
