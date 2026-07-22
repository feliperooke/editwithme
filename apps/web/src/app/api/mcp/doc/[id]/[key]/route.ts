import { getDocumentData } from "@/lib/data";
import { makeScopedMcpHandler } from "@/lib/scopedMcpHandler";

type Context = { params: Promise<{ id: string; key: string }> };

// Document-scoped remote MCP endpoint: /api/mcp/doc/<id>/<editKey>.
// Paste this into claude.ai as a custom connector to give an agent
// edit access to exactly one document — the id is in the URL and the
// tools cannot reach any other document. A wrong id/key answers 404
// (a 401 would trigger claude.ai's OAuth discovery, unimplemented).
async function scoped(request: Request, { params }: Context) {
  const { id, key } = await params;
  const doc = await getDocumentData(id);
  if (!doc || !key || key !== doc.editToken) {
    return new Response("Not found", { status: 404 });
  }
  // Rewrite to the canonical /api/mcp URL so the handler resolves the
  // transport from the path as usual
  const url = new URL(request.url);
  url.pathname = "/api/mcp";
  url.search = "";
  const forwarded = new Request(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    // Required by Node fetch when forwarding a streaming body
    duplex: "half",
  } as RequestInit);
  return makeScopedMcpHandler(id, key)(forwarded);
}

export { scoped as GET, scoped as POST, scoped as DELETE };
