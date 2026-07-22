import { EditorShell } from "@/components/EditorShell";

// View-only capability URL: /doc/<id> (no edit key in the path). Legacy
// ?key= links still grant edit via the searchParams fallback inside the
// editor.
export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditorShell id={id} editKey={null} />;
}
