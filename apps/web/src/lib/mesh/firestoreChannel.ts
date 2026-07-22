"use client";

import type { ChannelHandlers, SignalingChannel } from "@/lib/mesh/channel";

// Firestore-backed signaling: same mailbox semantics as the polling
// channel, but Google holds the connection — native Firestore listeners
// PUSH peers and messages to us (~100-300ms) with zero polling, and the
// whole workload fits comfortably in Firestore's daily free tier.
//
// The signaling path is keyed by a ROOM id = SHA-256(editKey), NOT the
// document id. The Firestore security rules leave these collections
// world-readable (needed for peer discovery without auth), so anyone
// with the public API key could enumerate them — but they only ever see
// opaque room hashes, never a document id (which would grant read
// access to the document itself). Only edit-key holders can derive the
// room, and only editors run a mesh. Payloads are additionally AES-GCM
// encrypted with the edit key.
//
// Data model (TTL fields cleaned up by Firestore, liveness decided
// client-side by lastSeen):
//   signaling/{room}/peers/{peerId}    { lastSeen, expireAt }
//   signaling/{room}/messages/{autoId} { to, from, payload, createdAt, expireAt }

export interface FirestoreChannelConfig {
  apiKey: string;
  projectId: string;
  appId?: string | null;
  // Edit key of the document — the room id is derived from it
  editKey: string;
}

const HEARTBEAT_MS = 45_000;
const PEER_FRESH_MS = 75_000;
const DOC_TTL_MS = 10 * 60_000;

// Room id = hex SHA-256 of the edit key: deterministic (all peers of a
// document compute the same value) and one-way (an enumerator cannot
// recover the edit key or the document id from it).
async function deriveRoomId(editKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(editKey);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class FirestoreChannel implements SignalingChannel {
  private stopped = false;
  private unsubscribers: Array<() => void> = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private firestore: typeof import("firebase/firestore") | null = null;
  private db: import("firebase/firestore").Firestore | null = null;
  private roomId: string | null = null;

  constructor(
    private peerId: string,
    private config: FirestoreChannelConfig
  ) {}

  start(handlers: ChannelHandlers) {
    void this.init(handlers);
  }

  private async init(handlers: ChannelHandlers) {
    const { initializeApp, getApps } = await import("firebase/app");
    const fs = await import("firebase/firestore");
    const roomId = await deriveRoomId(this.config.editKey);
    if (this.stopped) return;

    const app =
      getApps()[0] ??
      initializeApp({
        apiKey: this.config.apiKey,
        projectId: this.config.projectId,
        appId: this.config.appId ?? undefined,
      });
    const db = fs.getFirestore(app);
    this.firestore = fs;
    this.db = db;
    this.roomId = roomId;

    const peers = fs.collection(db, "signaling", roomId, "peers");
    const messages = fs.collection(db, "signaling", roomId, "messages");

    // Presence: heartbeat instead of poll — listeners do the delivery
    const beat = () => {
      void fs
        .setDoc(fs.doc(peers, this.peerId), {
          lastSeen: Date.now(),
          expireAt: fs.Timestamp.fromMillis(Date.now() + DOC_TTL_MS),
        })
        .catch(() => {});
    };
    beat();
    this.heartbeat = setInterval(beat, HEARTBEAT_MS);

    this.unsubscribers.push(
      fs.onSnapshot(
        peers,
        (snapshot) => {
          const now = Date.now();
          const fresh: string[] = [];
          snapshot.forEach((docSnap) => {
            const lastSeen = (docSnap.data().lastSeen as number) ?? 0;
            if (docSnap.id !== this.peerId && now - lastSeen < PEER_FRESH_MS) {
              fresh.push(docSnap.id);
            }
          });
          handlers.onPeers(fresh);
        },
        () => {
          // Listener error (offline, rules): mesh simply won't form;
          // the provider's server-diff fallback keeps sync converging
        }
      )
    );

    // Inbox: consume-on-read, ordered per sender by createdAt so SDP
    // descriptions arrive before their ICE candidates. Messages are not
    // deleted (rules deny it — DoS hardening); Firestore TTL reclaims
    // them, and only `added` changes are processed so they never replay.
    const inbox = fs.query(messages, fs.where("to", "==", this.peerId));
    this.unsubscribers.push(
      fs.onSnapshot(
        inbox,
        (snapshot) => {
          const added = snapshot
            .docChanges()
            .filter((change) => change.type === "added")
            .sort(
              (a, b) =>
                ((a.doc.data().createdAt as number) ?? 0) -
                ((b.doc.data().createdAt as number) ?? 0)
            );
          for (const change of added) {
            const data = change.doc.data();
            handlers.onMessage(data.from as string, data.payload as string);
          }
        },
        () => {}
      )
    );
  }

  async send(to: string, payload: string): Promise<void> {
    if (!this.firestore || !this.db || !this.roomId) return;
    const fs = this.firestore;
    await fs
      .addDoc(fs.collection(this.db, "signaling", this.roomId, "messages"), {
        to,
        from: this.peerId,
        payload,
        createdAt: Date.now(),
        expireAt: fs.Timestamp.fromMillis(Date.now() + DOC_TTL_MS),
      })
      .catch(() => {});
  }

  stop() {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
  }
}
