import { NextResponse } from "next/server";
import {
  deleteDocumentData,
  getDocumentData,
  updateDocumentHeadData,
  updateDocumentTitleData,
} from "@/lib/data";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const doc = await getDocumentData(id);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  // The edit token never leaves through this endpoint: anyone holding
  // the id has read access, but must not learn the write capability
  const { editToken: _editToken, ...payload } = doc;
  return NextResponse.json(payload);
}

export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  // Writing metadata requires the edit capability, like content writes
  const existing = await getDocumentData(id);
  if (!existing) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  const key = request.headers.get("x-edit-key") ?? "";
  if (!key || key !== existing.editToken) {
    return NextResponse.json({ error: "invalid edit key" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title : undefined;
  const headHtml =
    typeof body?.headHtml === "string" ? body.headHtml : undefined;
  if (title === undefined && headHtml === undefined) {
    return NextResponse.json(
      { error: "title or headHtml is required" },
      { status: 400 }
    );
  }
  let doc = null;
  if (title !== undefined) {
    doc = await updateDocumentTitleData(id, title.trim() || "Untitled");
  }
  if (headHtml !== undefined) {
    doc = await updateDocumentHeadData(id, headHtml);
  }
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  const { editToken: _editToken, ...payload } = doc;
  return NextResponse.json(payload);
}

export async function DELETE(request: Request, { params }: Context) {
  // Deletion requires the edit capability, like any other write
  const { id } = await params;
  const existing = await getDocumentData(id);
  if (!existing) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  const key = request.headers.get("x-edit-key") ?? "";
  if (!key || key !== existing.editToken) {
    return NextResponse.json({ error: "invalid edit key" }, { status: 403 });
  }
  await deleteDocumentData(id);
  return new NextResponse(null, { status: 204 });
}
