import { NextResponse } from "next/server";
import { getObjectStore } from "@/lib/storage/objectStore";

type Context = { params: Promise<{ id: string }> };

// Stateless signaling mailbox over the object store — no WebSocket
// anywhere. GET announces the caller (lastSeen bump), returns fresh
// peers and consumes the caller's inbox; POST drops an encrypted
// handshake payload into another peer's inbox. Payloads are AES-GCM
// encrypted with the edit key client-side, so the mailbox being open
// does not open the mesh.

const PEER_TTL_MS = 45_000;

const peersPrefix = (id: string) => `signaling/${id}/peers/`;
const inboxPrefix = (id: string, peerId: string) =>
  `signaling/${id}/inbox/${peerId}/`;

const safeId = (value: string) => /^[\w-]{1,64}$/.test(value);

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  const url = new URL(request.url);
  const peerId = url.searchParams.get("peerId") ?? "";
  if (!safeId(peerId)) {
    return NextResponse.json({ error: "invalid peerId" }, { status: 400 });
  }
  const store = getObjectStore();
  const now = Date.now();

  // Implicit announce: polling IS presence
  await store.put(
    `${peersPrefix(id)}${peerId}.json`,
    Buffer.from(JSON.stringify({ lastSeen: now }))
  );

  // Fresh peers (opportunistically pruning expired ones)
  const peers: string[] = [];
  for (const name of await store.list(peersPrefix(id))) {
    const object = await store.get(name);
    if (!object) continue;
    const otherId = name.slice(peersPrefix(id).length).replace(/\.json$/, "");
    try {
      const { lastSeen } = JSON.parse(object.data.toString("utf8"));
      if (now - lastSeen > PEER_TTL_MS) {
        await store.delete(name);
      } else {
        peers.push(otherId);
      }
    } catch {
      await store.delete(name);
    }
  }

  // Consume-on-read inbox (one consumer per peerId)
  const messages: { from: string; payload: string }[] = [];
  for (const name of await store.list(inboxPrefix(id, peerId))) {
    const object = await store.get(name);
    if (object) {
      try {
        messages.push(JSON.parse(object.data.toString("utf8")));
      } catch {
        // Drop malformed entries
      }
    }
    await store.delete(name);
  }

  return NextResponse.json({ peers, messages });
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const from = typeof body?.peerId === "string" ? body.peerId : "";
  const to = typeof body?.to === "string" ? body.to : "";
  const payload = typeof body?.payload === "string" ? body.payload : "";
  if (!safeId(from) || !safeId(to) || !payload || payload.length > 64_000) {
    return NextResponse.json({ error: "invalid signal" }, { status: 400 });
  }
  const store = getObjectStore();
  const name = `${inboxPrefix(id, to)}${Date.now().toString().padStart(15, "0")}-${crypto
    .randomUUID()
    .slice(0, 8)}.json`;
  await store.put(name, Buffer.from(JSON.stringify({ from, payload })));
  return NextResponse.json({ ok: true });
}
