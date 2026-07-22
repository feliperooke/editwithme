"use client";

import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { YMesh } from "@/lib/mesh/mesh";
import { PollingChannel, type SignalingChannel } from "@/lib/mesh/channel";

// P2P sync provider — no WebSocket anywhere:
// - Editors form a WebRTC mesh (own implementation: raw
//   RTCPeerConnection + y-protocols over data channels) discovered via
//   the stateless polling signaling mailbox; handshakes are encrypted
//   with the edit key, so the mesh is editors-only.
// - An elected leader (lowest awareness clientID) pushes CRDT diffs to
//   the archivist server with debounce; everyone pulls on join.
// - Viewers poll cheap diffs. Editors WITHOUT mesh peers also fall back
//   to diff polling, so collaboration converges even if WebRTC fails.
//
// Exposes the surface CollaborativeEditor expects:
// awareness / on("status") / off / destroy.

const PUSH_INTERVAL_MS = 10_000;
const VIEWER_POLL_MS = 5_000;
const SERVER_ORIGIN = "p2p-server-pull";

type StatusPayload = { status: string };
type StatusListener = (payload: StatusPayload) => void;

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
};
const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

export class P2pProvider {
  awareness: Awareness;
  private mesh: YMesh | null = null;
  private listeners = new Set<StatusListener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private serverStateVector: string | null = null;
  private dirty = false;
  private destroyed = false;
  private status = "connecting";
  private cleanupFns: Array<() => void> = [];
  private tick = 0;

  constructor(
    private docId: string,
    private editKey: string | null,
    private ydoc: Y.Doc,
    iceServers: RTCIceServer[],
    channelFactory?: (docId: string, peerId: string) => SignalingChannel
  ) {
    this.awareness = new Awareness(ydoc);

    if (editKey) {
      const peerId = crypto.randomUUID();
      const channel = channelFactory
        ? channelFactory(docId, peerId)
        : new PollingChannel(docId, peerId);
      this.mesh = new YMesh(
        peerId,
        docId,
        editKey,
        ydoc,
        this.awareness,
        channel,
        iceServers
      );
      this.ydoc.on("update", this.onUpdate);
      const flush = () => this.push(true);
      window.addEventListener("pagehide", flush);
      this.cleanupFns.push(() => window.removeEventListener("pagehide", flush));
    }

    // Ensure the document exists server-side right away, even before
    // any edit: a brand-new blank doc otherwise lives only in the
    // browser, and its capability URLs (view link, scoped MCP
    // connector) answer 404 until the first keystroke triggers a push.
    void this.initialPull().then(() => {
      if (this.editKey) void this.push(true, true);
    });
    this.timer = setInterval(() => {
      this.tick += 1;
      if (this.editKey) {
        void this.push(false);
        // Converge through the server when the mesh is empty — and even
        // with an active mesh, pull every ~30s so out-of-band revisions
        // (MCP / AI edits applied server-side) reach live editors
        if ((this.mesh?.openLinkCount ?? 0) === 0 || this.tick % 3 === 0) {
          void this.pullDiff();
        }
      } else {
        void this.pullDiff();
      }
    }, this.editKey ? PUSH_INTERVAL_MS : VIEWER_POLL_MS);
  }

  private onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin !== SERVER_ORIGIN) this.dirty = true;
  };

  // Immediate server pull, bypassing the interval — used after
  // server-side writes the client wants reflected right away (e.g.
  // restoring a version from the history sheet).
  async pullNow(): Promise<void> {
    await this.pullDiff();
  }

  private setStatus(status: string) {
    if (this.status === status) return;
    this.status = status;
    this.listeners.forEach((cb) => cb({ status }));
  }

  private async initialPull() {
    try {
      const response = await fetch(`/api/documents/${this.docId}/sync`);
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as {
        update: string;
        stateVector: string;
      };
      if (this.destroyed) return;
      Y.applyUpdate(this.ydoc, fromBase64(data.update), SERVER_ORIGIN);
      this.serverStateVector = data.stateVector;
      this.setStatus("connected");
    } catch {
      // Offline: IndexedDB already hydrated the doc; checkpoints resume
      // on the next successful push/pull
      this.setStatus("disconnected");
    }
  }

  // Leader = lowest clientID among awareness states (deterministic, no
  // coordination). Solo editors are trivially the leader.
  private isLeader(): boolean {
    const ids = Array.from(this.awareness.getStates().keys()) as number[];
    if (ids.length === 0) return true;
    return Math.min(...ids) === this.ydoc.clientID;
  }

  private async push(force: boolean, allowEmpty = false) {
    if (!this.editKey || this.destroyed) return;
    if (!force && (!this.dirty || !this.isLeader())) return;
    const base = this.serverStateVector
      ? fromBase64(this.serverStateVector)
      : undefined;
    const update = Y.encodeStateAsUpdate(this.ydoc, base);
    // Empty updates are skipped as noise — except for the ensure-exists
    // push, where an empty update still creates the document server-side
    if (update.length <= 2 && !allowEmpty) {
      this.dirty = false;
      return;
    }
    try {
      const response = await fetch(`/api/documents/${this.docId}/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-edit-key": this.editKey,
        },
        body: JSON.stringify({ update: toBase64(update) }),
        keepalive: force,
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { stateVector: string };
      this.serverStateVector = data.stateVector;
      this.dirty = false;
      this.setStatus("connected");
    } catch {
      this.setStatus("disconnected");
    }
  }

  private async pullDiff() {
    if (this.destroyed) return;
    try {
      const sv = toBase64(Y.encodeStateVector(this.ydoc));
      const response = await fetch(
        `/api/documents/${this.docId}/sync?sv=${encodeURIComponent(sv)}`
      );
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { update: string };
      if (this.destroyed) return;
      Y.applyUpdate(this.ydoc, fromBase64(data.update), SERVER_ORIGIN);
      this.setStatus("connected");
    } catch {
      this.setStatus("disconnected");
    }
  }

  on(event: string, cb: StatusListener) {
    if (event === "status") {
      this.listeners.add(cb);
      cb({ status: this.status });
    }
  }

  off(event: string, cb: StatusListener) {
    if (event === "status") this.listeners.delete(cb);
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    this.ydoc.off("update", this.onUpdate);
    this.cleanupFns.forEach((fn) => fn());
    // Final best-effort flush, then tell peers we are leaving while the
    // links are still open
    void this.push(true);
    this.awareness.setLocalState(null);
    this.mesh?.destroy();
    this.awareness.destroy();
  }
}

export async function createP2pProvider(options: {
  docId: string;
  editKey: string | null;
  ydoc: Y.Doc;
}): Promise<P2pProvider> {
  let iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  try {
    const response = await fetch("/api/turn");
    if (response.ok) {
      const data = (await response.json()) as { iceServers: RTCIceServer[] };
      iceServers = data.iceServers;
    }
  } catch {
    // STUN-only fallback (direct/LAN pairs still connect)
  }

  // Transport selection: Firestore listeners (push, free-tier) when the
  // deployment is wired for it; HTTP polling mailbox otherwise (dev)
  let channelFactory:
    | ((docId: string, peerId: string) => SignalingChannel)
    | undefined;
  try {
    const response = await fetch("/api/signaling-config");
    if (response.ok) {
      const config = (await response.json()) as {
        transport: string;
        apiKey?: string;
        projectId?: string;
        appId?: string | null;
      };
      if (
        config.transport === "firestore" &&
        config.apiKey &&
        config.projectId &&
        options.editKey
      ) {
        const { FirestoreChannel } = await import("@/lib/mesh/firestoreChannel");
        // The signaling room is derived from the edit key inside the
        // channel; docId never reaches Firestore. Editors only (the
        // factory runs solely when editKey is present).
        const editKey = options.editKey;
        channelFactory = (_docId, peerId) =>
          new FirestoreChannel(peerId, {
            apiKey: config.apiKey!,
            projectId: config.projectId!,
            appId: config.appId,
            editKey,
          });
      }
    }
  } catch {
    // Polling fallback
  }

  return new P2pProvider(
    options.docId,
    options.editKey,
    options.ydoc,
    iceServers,
    channelFactory
  );
}
