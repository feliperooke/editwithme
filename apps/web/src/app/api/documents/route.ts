import { NextResponse } from "next/server";
import { createDocumentData } from "@/lib/data";

// There is deliberately no GET (listing): the access model is
// capability URLs — knowing a document's id grants read, its edit key
// grants write. A listing endpoint would leak every capability at once.

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.title !== "string" ||
    typeof body.html !== "string"
  ) {
    return NextResponse.json(
      { error: "title and html are required" },
      { status: 400 }
    );
  }

  const doc = await createDocumentData({
    title: body.title.trim() || "Untitled",
    html: body.html,
    headHtml: typeof body.headHtml === "string" ? body.headHtml : null,
    bodyAttrs: typeof body.bodyAttrs === "string" ? body.bodyAttrs : null,
  });
  return NextResponse.json(doc, { status: 201 });
}
