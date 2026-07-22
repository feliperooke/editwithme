import { NextResponse } from "next/server";
import * as Y from "yjs";
import { appendSyncUpdate, readSyncState } from "@/lib/data";

type Context = { params: Promise<{ id: string }> };

// Checkpoint endpoints for the P2P "archivist" sync model. Updates are
// CRDT (commutative/idempotent); on the objects driver, pushes append
// immutable log objects — race-free by construction.

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const fromBase64 = (value: string) =>
  new Uint8Array(Buffer.from(value, "base64"));

// GET: snapshot pull. With ?sv=<base64 state vector>, returns only the
// missing diff (cheap polling for viewers and rejoining editors).
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  const { ydoc } = await readSyncState(id);

  const url = new URL(request.url);
  const sv = url.searchParams.get("sv");
  const update = sv
    ? Y.encodeStateAsUpdate(ydoc, fromBase64(sv))
    : Y.encodeStateAsUpdate(ydoc);

  return NextResponse.json({
    update: toBase64(update),
    stateVector: toBase64(Y.encodeStateVector(ydoc)),
  });
}

// POST: checkpoint push from the elected leader. Requires the edit key;
// adopts the key when the document does not exist yet.
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.update !== "string") {
    return NextResponse.json({ error: "update is required" }, { status: 400 });
  }
  const key =
    request.headers.get("x-edit-key") ??
    (typeof body.key === "string" ? body.key : "");

  const stateVector = await appendSyncUpdate(id, fromBase64(body.update), key);
  if (!stateVector) {
    return NextResponse.json({ error: "invalid edit key" }, { status: 403 });
  }
  return NextResponse.json({ stateVector: toBase64(stateVector) });
}
