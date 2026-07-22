"use client";

import { useEffect, useState } from "react";
import { CollaborativeEditor } from "@/components/CollaborativeEditor";

// The collaborative editor opens network connections and uses
// localStorage, so it is only mounted on the client.
export function EditorShell({
  id,
  editKey,
}: {
  id: string;
  editKey: string | null;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="editor-loading">Loading editor…</div>;
  }
  return <CollaborativeEditor id={id} editKey={editKey} />;
}
