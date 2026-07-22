"use client";

import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import type { Awareness } from "y-protocols/awareness";
import { PeerLink } from "@/lib/mesh/peerLink";
import { SignalCrypto } from "@/lib/mesh/crypto";
import type { SignalingChannel } from "@/lib/mesh/channel";

// Editors-only WebRTC mesh with raw RTCPeerConnection:
// - Deterministic roles: the lexicographically LOWER peerId creates the
//   offer and the data channel — offer glare cannot happen.
// - Signaling payloads are AES-GCM encrypted with the edit key: peers
//   without the key cannot complete a handshake.
// - Per-peer sessions: a new connection attempt carries a session id,
//   so stale signals from a previous attempt are ignored.

interface SignalEnvelope {
  session: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

interface PeerState {
  session: string;
  pc: RTCPeerConnection;
  link: PeerLink | null;
  channel: RTCDataChannel | null;
}

const RETRY_COOLDOWN_MS = 8_000;

export class YMesh {
  private peers = new Map<string, PeerState>();
  private lastAttempt = new Map<string, number>();
  private crypto: SignalCrypto;
  private destroyed = false;
  onPeersChanged: (openLinks: number) => void = () => {};

  constructor(
    private myPeerId: string,
    docId: string,
    editKey: string,
    private ydoc: Y.Doc,
    private awareness: Awareness,
    private channel: SignalingChannel & { fastMode?: boolean },
    private iceServers: RTCIceServer[]
  ) {
    this.crypto = new SignalCrypto(editKey, docId);
    this.ydoc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
    channel.start({
      onPeers: (peerIds) => this.reconcilePeers(peerIds),
      onMessage: (from, payload) => void this.onSignal(from, payload),
    });
  }

  get openLinkCount(): number {
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.channel?.readyState === "open") count++;
    }
    return count;
  }

  private updateFastMode() {
    const pending = [...this.peers.values()].some(
      (p) => p.channel?.readyState !== "open"
    );
    this.channel.fastMode = pending;
    this.onPeersChanged(this.openLinkCount);
  }

  private reconcilePeers(peerIds: string[]) {
    if (this.destroyed) return;
    const now = Date.now();
    for (const peerId of peerIds) {
      if (this.peers.has(peerId)) continue;
      if ((this.lastAttempt.get(peerId) ?? 0) + RETRY_COOLDOWN_MS > now) continue;
      // Lower peerId initiates; the higher side waits for the offer
      if (this.myPeerId < peerId) {
        this.lastAttempt.set(peerId, now);
        void this.connectTo(peerId, crypto.randomUUID().slice(0, 8), true);
      }
    }
    // Drop links whose peers vanished from discovery
    for (const [peerId, peer] of this.peers) {
      if (!peerIds.includes(peerId) && peer.channel?.readyState !== "open") {
        this.teardown(peerId);
      }
    }
  }

  private createPeer(peerId: string, session: string, initiator: boolean) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const state: PeerState = { session, pc, link: null, channel: null };
    this.peers.set(peerId, state);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void this.sendSignal(peerId, {
          session,
          candidate: event.candidate.toJSON(),
        });
      }
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        this.teardown(peerId);
      }
    };
    const attachChannel = (channel: RTCDataChannel) => {
      channel.binaryType = "arraybuffer";
      state.channel = channel;
      channel.onopen = () => {
        const link = new PeerLink(
          { send: (data) => channel.send(data as Uint8Array<ArrayBuffer>) },
          this.ydoc,
          this.awareness
        );
        state.link = link;
        channel.onmessage = (event) =>
          link.receive(new Uint8Array(event.data as ArrayBuffer));
        link.start();
        this.updateFastMode();
      };
      channel.onclose = () => this.teardown(peerId);
    };
    if (initiator) {
      attachChannel(pc.createDataChannel("y", { ordered: true }));
    } else {
      pc.ondatachannel = (event) => attachChannel(event.channel);
    }
    this.updateFastMode();
    return state;
  }

  private async connectTo(peerId: string, session: string, initiator: boolean) {
    const state = this.createPeer(peerId, session, initiator);
    if (initiator) {
      const offer = await state.pc.createOffer();
      await state.pc.setLocalDescription(offer);
      await this.sendSignal(peerId, { session, description: offer });
    }
  }

  private async sendSignal(to: string, envelope: SignalEnvelope) {
    const payload = await this.crypto.encrypt(envelope);
    await this.channel.send(to, payload);
  }

  private async onSignal(from: string, payload: string) {
    if (this.destroyed) return;
    const envelope = (await this.crypto.decrypt(payload)) as SignalEnvelope | null;
    if (!envelope?.session) return;

    let state = this.peers.get(from);
    // New session from the peer: replace any stale connection state
    if (state && state.session !== envelope.session) {
      this.teardown(from);
      state = undefined;
    }
    if (!state) {
      if (this.myPeerId < from) return; // initiator ignores unknown sessions
      state = this.createPeer(from, envelope.session, false);
    }

    try {
      if (envelope.description) {
        await state.pc.setRemoteDescription(envelope.description);
        if (envelope.description.type === "offer") {
          const answer = await state.pc.createAnswer();
          await state.pc.setLocalDescription(answer);
          await this.sendSignal(from, {
            session: envelope.session,
            description: answer,
          });
        }
      } else if (envelope.candidate) {
        await state.pc.addIceCandidate(envelope.candidate);
      }
    } catch {
      this.teardown(from);
    }
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    for (const peer of this.peers.values()) {
      if (peer.link && peer.link !== origin) peer.link.sendDocUpdate(update);
    }
  };

  private onAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    const changed = [...changes.added, ...changes.updated, ...changes.removed];
    if (changed.length === 0) return;
    const update = awarenessProtocol.encodeAwarenessUpdate(
      this.awareness,
      changed
    );
    for (const peer of this.peers.values()) {
      if (peer.link && peer.link !== origin) peer.link.sendAwarenessUpdate(update);
    }
  };

  private teardown(peerId: string) {
    const state = this.peers.get(peerId);
    if (!state) return;
    this.peers.delete(peerId);
    state.channel?.close();
    state.pc.close();
    this.updateFastMode();
  }

  destroy() {
    this.destroyed = true;
    this.ydoc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    for (const peerId of [...this.peers.keys()]) this.teardown(peerId);
    this.channel.stop();
  }
}
