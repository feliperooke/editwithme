"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { addLocalDoc } from "@/lib/localDocs";

// There is no document list: the app is a blank-file editor. Visiting
// the root creates a fresh document instantly (id + edit key generated
// client-side, Excalidraw-style — works offline, no API round-trip)
// and redirects to it. Existing documents are reached by their
// capability URLs.
export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const id = crypto.randomUUID();
    const key = crypto.randomUUID();
    addLocalDoc({
      id,
      key,
      title: "Untitled",
      createdAt: new Date().toISOString(),
    });
    router.replace(`/doc/${id}/${key}`);
  }, [router]);

  return <div className="editor-loading">Creating a new document…</div>;
}
