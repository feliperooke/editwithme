import { NextResponse } from "next/server";
import { replaceDocumentContent } from "@/lib/data";
import { editDocumentContent, resolveCommentContent } from "@/lib/revise";

type Context = { params: Promise<{ id: string }> };

// Replaces the document body with new HTML (MCP / AI revision path).
// The replacement is applied as a CRDT delta (delete + insert in one
// transaction), so concurrent editor changes merge instead of being
// clobbered, and live editors pick it up via their periodic pull.
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.html !== "string") {
    return NextResponse.json({ error: "html is required" }, { status: 400 });
  }
  const key = request.headers.get("x-edit-key") ?? "";
  const ok = await replaceDocumentContent(id, body.html, key);
  if (!ok) {
    return NextResponse.json(
      { error: "document not found or invalid edit key" },
      { status: 403 }
    );
  }
  return NextResponse.json({ ok: true });
}

// Targeted edits (MCP stdio client): {find, replace} for an exact-match
// snippet replacement, {comment, html} to resolve a comment's anchored
// range. Both fail loudly instead of clobbering — a truncated caller
// payload cannot wipe the document.
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const key = request.headers.get("x-edit-key") ?? "";
  let result;
  if (body && typeof body.find === "string" && typeof body.replace === "string") {
    result = await editDocumentContent(id, body.find, body.replace, key);
  } else if (
    body &&
    typeof body.comment === "string" &&
    typeof body.html === "string"
  ) {
    result = await resolveCommentContent(id, body.comment, body.html, key);
  } else {
    return NextResponse.json(
      { error: "expected {find, replace} or {comment, html}" },
      { status: 400 }
    );
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }
  return NextResponse.json({ ok: true });
}
