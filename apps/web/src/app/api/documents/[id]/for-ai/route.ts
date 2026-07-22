import { NextResponse } from "next/server";
import { getDocumentData } from "@/lib/data";
import { buildAiExportServer } from "@/lib/aiExportServer";

type Context = { params: Promise<{ id: string }> };

// Server-side "Export for AI": the same revision-request markdown the
// editor's "For AI" button produces (comments as anchored tasks,
// <!--cN--> markers). Read access = knowing the id, like the document GET.
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  const doc = await getDocumentData(id);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  // ?mode=tools: variant for MCP clients — verbatim HTML + comment ids,
  // instructions point at resolve_comment/edit_document instead of
  // asking for the complete rewritten document.
  const mode =
    new URL(request.url).searchParams.get("mode") === "tools"
      ? ("tools" as const)
      : ("clipboard" as const);
  const markdown = buildAiExportServer({
    title: doc.title,
    bodyHtml: doc.html,
    mode,
  });
  return new NextResponse(markdown, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
