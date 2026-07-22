"use client";

// Pluggable signaling channel: peer discovery + point-to-point message
// delivery, with NO persistent connection required by the contract.
// Transports:
// - PollingChannel (default): HTTP polling against the stateless
//   mailbox API — FaaS-pure today, works locally and on Cloud Run.
// - Firestore transport (planned): same interface, delivered with the
//   GCP provisioning step — swaps in via env without touching the mesh.

export interface ChannelHandlers {
  onPeers(peerIds: string[]): void;
  onMessage(from: string, payload: string): void;
}

export interface SignalingChannel {
  start(handlers: ChannelHandlers): void;
  send(to: string, payload: string): Promise<void>;
  stop(): void;
}

const FAST_POLL_MS = 1_000;
const SLOW_POLL_MS = 4_000;

export class PollingChannel implements SignalingChannel {
  private handlers: ChannelHandlers | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  // The mesh flips this while handshakes are in flight for faster
  // signal exchange, and back for cheap steady-state discovery
  fastMode = false;

  constructor(
    private docId: string,
    private peerId: string
  ) {}

  start(handlers: ChannelHandlers) {
    this.handlers = handlers;
    void this.loop();
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(
      () => void this.loop(),
      this.fastMode ? FAST_POLL_MS : SLOW_POLL_MS
    );
  }

  private async loop() {
    if (this.stopped) return;
    try {
      const response = await fetch(
        `/api/documents/${this.docId}/signal?peerId=${encodeURIComponent(this.peerId)}`,
        { method: "GET" }
      );
      if (response.ok) {
        const data = (await response.json()) as {
          peers: string[];
          messages: { from: string; payload: string }[];
        };
        if (this.stopped || !this.handlers) return;
        this.handlers.onPeers(data.peers.filter((p) => p !== this.peerId));
        for (const message of data.messages) {
          this.handlers.onMessage(message.from, message.payload);
        }
      }
    } catch {
      // Offline: discovery resumes on the next tick
    }
    this.schedule();
  }

  async send(to: string, payload: string): Promise<void> {
    await fetch(`/api/documents/${this.docId}/signal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ peerId: this.peerId, to, payload }),
    }).catch(() => {
      // Best-effort: the mesh retries handshakes on the next discovery
    });
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.handlers = null;
  }
}
