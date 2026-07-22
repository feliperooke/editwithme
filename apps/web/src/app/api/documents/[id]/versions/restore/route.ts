import { NextResponse } from "next/server";
import { replaceDocumentContent } from "@/lib/data";
import { dropVersionsAfter, readVersion } from "@/lib/versions";

type Context = { params: Promise<{ id: string }> };

// Restores an old version: the document content becomes that snapshot
// (applied server-side as ONE minimal CRDT delta — restoring is a
// single authoritative write, so two clients restoring concurrently
// cannot duplicate content) and every newer version is dropped ("the
// future history is replaced"). Requires the edit capability.
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const at = Number(body?.at);
  if (!Number.isFinite(at)) {
    return NextResponse.json({ error: "at is required" }, { status: 400 });
  }
  const key = request.headers.get("x-edit-key") ?? "";
  const version = await readVersion(id, at);
  if (!version) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }
  const ok = await replaceDocumentContent(id, version.html, key);
  if (!ok) {
    return NextResponse.json({ error: "invalid edit key" }, { status: 403 });
  }
  await dropVersionsAfter(id, at);
  return NextResponse.json({ ok: true });
}
