/**
 * WebSocket handler — minimal implementation using raw Node.js.
 *
 * Implements RFC 6455 framing for text messages. Supports broadcasting
 * scan progress, agent events, and completion notifications.
 *
 * For production, consider a library like `ws`. This is intentionally
 * minimal to avoid heavy dependencies.
 */
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const WS_GUID = "258EAFA5-E914-47DA-95CA-5AB5DC76B45E";

interface WebSocketClient {
  id: string;
  socket: Duplex;
  subscriptions: Set<string>;
}

export class WebSocketHandler {
  private clients = new Map<string, WebSocketClient>();
  private nextId = 0;

  /** Try to upgrade an HTTP request to a WebSocket connection. */
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ): boolean {
    const upgradeHeader = (req.headers.upgrade ?? "").toLowerCase();
    if (upgradeHeader !== "websocket") return false;

    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return true;
    }

    const accept = createHash("sha1")
      .update(key + WS_GUID)
      .digest("base64");

    const headers = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n");

    socket.write(headers);

    const id = `ws_${++this.nextId}`;
    const client: WebSocketClient = {
      id,
      socket,
      subscriptions: new Set(["*"]),
    };
    this.clients.set(id, client);

    socket.on("close", () => {
      this.clients.delete(id);
    });
    socket.on("error", () => {
      this.clients.delete(id);
    });

    // Handle incoming frames (ping/pong/close)
    socket.on("data", (chunk: Buffer) => {
      this.handleFrame(client, chunk);
    });

    // Send welcome message
    this.sendToClient(client, {
      type: "connected",
      clientId: id,
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  /** Broadcast an event to all connected clients. */
  broadcast(event: { type: string; [key: string]: unknown }): void {
    const payload = JSON.stringify(event);
    for (const client of this.clients.values()) {
      this.sendRaw(client, payload);
    }
  }

  /** Broadcast a scan progress event. */
  broadcastScanProgress(
    scanId: string,
    data: { status: string; progress?: number; message?: string }
  ): void {
    this.broadcast({ type: "scan:progress", scanId, ...data });
  }

  /** Broadcast an agent event. */
  broadcastAgentEvent(
    scanId: string,
    data: { eventType: string; payload: unknown }
  ): void {
    this.broadcast({ type: "agent:event", scanId, ...data });
  }

  /** Broadcast scan completion. */
  broadcastScanComplete(
    scanId: string,
    data: { status: string; summary?: string }
  ): void {
    this.broadcast({ type: "scan:completed", scanId, ...data });
  }

  /** Get the number of connected clients. */
  get clientCount(): number {
    return this.clients.size;
  }

  /** Close all connections. */
  closeAll(): void {
    for (const client of this.clients.values()) {
      try {
        // Send close frame (opcode 0x8)
        const frame = this.encodeFrame(0x8, Buffer.alloc(0));
        client.socket.write(frame);
        client.socket.end();
      } catch {
        client.socket.destroy();
      }
    }
    this.clients.clear();
  }

  // ── Frame handling ──

  private handleFrame(client: WebSocketClient, data: Buffer): void {
    if (data.length < 2) return;

    const firstByte = data[0]!;
    const secondByte = data[1]!;
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;

    let offset = 2;
    if (payloadLength === 126) {
      if (data.length < 4) return;
      payloadLength = data.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      if (data.length < 10) return;
      payloadLength = Number(data.readBigUInt64BE(2));
      offset = 10;
    }

    let maskKey: Buffer | undefined;
    if (masked) {
      if (data.length < offset + 4) return;
      maskKey = data.subarray(offset, offset + 4);
      offset += 4;
    }

    const payload = data.subarray(offset, offset + payloadLength);
    if (maskKey) {
      for (let i = 0; i < payload.length; i++) {
        (payload as Buffer)[i] = payload[i]! ^ maskKey[i % 4]!;
      }
    }

    switch (opcode) {
      case 0x1: // Text
        // Parse subscription messages
        try {
          const msg = JSON.parse(payload.toString("utf8")) as {
            type?: string;
            subscribe?: string;
          };
          if (msg.type === "subscribe" && msg.subscribe) {
            client.subscriptions.add(msg.subscribe);
          }
        } catch {
          // Ignore parse errors on incoming frames
        }
        break;
      case 0x8: // Close
        client.socket.end();
        break;
      case 0x9: // Ping → Pong
        this.sendRawFrame(client, 0xa, payload);
        break;
      case 0xa: // Pong — ignore
        break;
    }
  }

  private sendToClient(
    client: WebSocketClient,
    data: Record<string, unknown>
  ): void {
    this.sendRaw(client, JSON.stringify(data));
  }

  private sendRaw(client: WebSocketClient, payload: string): void {
    try {
      const buf = Buffer.from(payload, "utf8");
      const frame = this.encodeFrame(0x1, buf);
      client.socket.write(frame);
    } catch {
      // Client disconnected
    }
  }

  private sendRawFrame(
    client: WebSocketClient,
    opcode: number,
    payload: Buffer
  ): void {
    try {
      const frame = this.encodeFrame(opcode, payload);
      client.socket.write(frame);
    } catch {
      // Client disconnected
    }
  }

  private encodeFrame(opcode: number, payload: Buffer): Buffer {
    const len = payload.length;
    let headerLen: number;
    let lengthBytes: number;

    if (len < 126) {
      headerLen = 2;
      lengthBytes = 0;
    } else if (len < 65536) {
      headerLen = 4;
      lengthBytes = 2;
    } else {
      headerLen = 10;
      lengthBytes = 8;
    }

    const frame = Buffer.alloc(headerLen + len);
    frame[0] = 0x80 | opcode; // FIN + opcode

    if (lengthBytes === 0) {
      frame[1] = len;
    } else if (lengthBytes === 2) {
      frame[1] = 126;
      frame.writeUInt16BE(len, 2);
    } else {
      frame[1] = 127;
      frame.writeBigUInt64BE(BigInt(len), 2);
    }

    payload.copy(frame, headerLen);
    return frame;
  }
}
