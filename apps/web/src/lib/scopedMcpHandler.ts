import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { getDocumentData, updateDocumentTitleData } from "@/lib/data";
import { editDocumentContent, resolveCommentContent } from "@/lib/revise";
import { buildAiExportServer } from "@/lib/aiExportServer";

// Document-scoped MCP endpoint: /api/mcp/doc/<id>/<editKey>. The id and
// edit key live in the URL, so every tool acts on exactly one document
// and no tool takes an id/key parameter. Only per-document operations
// are exposed — no listing, creation, or deletion, and nothing can
// reach another document. This is the capability model of the
// open-source build: the URL IS the grant.

const text = (value: string) => ({
  content: [{ type: "text" as const, text: value }],
});

const appUrl = (id: string, key: string) => {
  const base = process.env.APP_PUBLIC_URL ?? "";
  const path = `/doc/${id}/${key}`;
  return base ? `${base}${path}` : path;
};

// One handler per (id, key). Cached so repeated calls on the same
// connector reuse it instead of rebuilding the tool set every request.
const cache = new Map<string, ReturnType<typeof createMcpHandler>>();

export function makeScopedMcpHandler(id: string, editKey: string) {
  const cacheKey = `${id}:${editKey}`;
  const existing = cache.get(cacheKey);
  if (existing) return existing;

  const handler = createMcpHandler(
    (server) => {
      server.tool(
        "read_document",
        "Reads this document's current HTML content (body) and metadata.",
        {},
        async () => {
          const doc = await getDocumentData(id);
          if (!doc) return text("Document not found.");
          const { editToken: _hidden, ...safe } = doc;
          return text(JSON.stringify(safe, null, 2));
        }
      );

      server.tool(
        "read_for_revision",
        "Reads this document as a revision request: team comments become a numbered task list with comment ids, followed by the exact body HTML. Apply each comment with resolve_comment and any other change with edit_document — never rewrite the whole document.",
        {},
        async () => {
          const doc = await getDocumentData(id);
          if (!doc) return text("Document not found.");
          return text(
            buildAiExportServer({
              title: doc.title,
              bodyHtml: doc.html,
              mode: "tools",
            })
          );
        }
      );

      server.tool(
        "edit_document",
        "Applies a targeted edit to this document's body: replaces one exact HTML snippet with a revised one, applied as a CRDT delta (concurrent editor changes merge; live editors see it within ~30s). find_html must match the stored HTML byte-for-byte and exactly once — copy it verbatim from read_document/read_for_revision and include enough context to be unique. Use several calls for several changes; never send the whole document.",
        {
          find_html: z
            .string()
            .describe("Exact HTML snippet to replace (verbatim, unique match)"),
          replace_html: z.string().describe("Revised HTML for that snippet"),
        },
        async ({ find_html, replace_html }) => {
          const result = await editDocumentContent(
            id,
            find_html,
            replace_html,
            editKey
          );
          return text(
            result.ok
              ? `Edit applied: ${appUrl(id, editKey)}`
              : `Failed: ${result.error}`
          );
        }
      );

      server.tool(
        "resolve_comment",
        "Resolves a team comment on this document: replaces the text range the comment is anchored to with new HTML and removes the comment. The server locates the range from the comment id (listed by read_for_revision), so only the replacement HTML is sent. Applied as a CRDT delta; live editors see it within ~30s.",
        {
          comment_id: z.string().describe("Comment id from read_for_revision"),
          html: z
            .string()
            .describe("Replacement HTML for the commented text range"),
        },
        async ({ comment_id, html }) => {
          const result = await resolveCommentContent(
            id,
            comment_id,
            html,
            editKey
          );
          return text(
            result.ok
              ? `Comment resolved: ${appUrl(id, editKey)}`
              : `Failed: ${result.error}`
          );
        }
      );

      server.tool(
        "update_title",
        "Renames this document.",
        { title: z.string() },
        async ({ title }) => {
          await updateDocumentTitleData(id, title);
          return text("Title updated.");
        }
      );
    },
    { serverInfo: { name: "editwithme", version: "1.0.0" } },
    { basePath: "/api" }
  );

  cache.set(cacheKey, handler);
  return handler;
}
