import { EditorShell } from "@/components/EditorShell";

// Edit capability URL: /doc/<id>/<editKey> — same path-based format as
// the document-scoped MCP connector (/api/mcp/doc/<id>/<editKey>).
export default async function DocumentEditPage({
  params,
}: {
  params: Promise<{ id: string; key: string }>;
}) {
  const { id, key } = await params;
  return <EditorShell id={id} editKey={key} />;
}
