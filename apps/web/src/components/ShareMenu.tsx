"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Check, Eye, Link2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Share popover: copies capability links. The edit link is the document
// URL itself (unguessable UUID); the view link opens the editor in
// read-only mode.
export function ShareMenu({
  docId,
  editKey,
}: {
  docId: string;
  editKey: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"edit" | "view" | "mcp" | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const copy = async (mode: "edit" | "view" | "mcp") => {
    // Path-based capability URLs, one format everywhere:
    //   edit  -> /doc/<id>/<key>
    //   view  -> /doc/<id>
    //   mcp   -> /api/mcp/doc/<id>/<key> (document-scoped connector)
    const path =
      mode === "mcp" && editKey
        ? `/api/mcp/doc/${docId}/${editKey}`
        : mode === "edit" && editKey
          ? `/doc/${docId}/${editKey}`
          : `/doc/${docId}`;
    const url = new URL(path, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(mode);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // clipboard unavailable (e.g. insecure context)
    }
  };

  return (
    <span className="share-menu-wrap" ref={wrapRef}>
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
        <Share2 /> Share
      </Button>
      {open && (
        <div className="share-menu">
          <button
            type="button"
            className="share-menu-item"
            onClick={() => copy("edit")}
          >
            {copied === "edit" ? (
              <Check className="size-4" />
            ) : (
              <Link2 className="size-4" />
            )}
            <span>
              {copied === "edit" ? "Copied!" : "Copy edit link"}
              <small>Contains the edit key — anyone with it can edit</small>
            </span>
          </button>
          <button
            type="button"
            className="share-menu-item"
            onClick={() => copy("view")}
          >
            {copied === "view" ? (
              <Check className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
            <span>
              {copied === "view" ? "Copied!" : "Copy view-only link"}
              <small>Read-only — enforced by the server</small>
            </span>
          </button>
          <button
            type="button"
            className="share-menu-item"
            onClick={() => copy("mcp")}
          >
            {copied === "mcp" ? (
              <Check className="size-4" />
            ) : (
              <Bot className="size-4" />
            )}
            <span>
              {copied === "mcp" ? "Copied!" : "Copy AI connector link"}
              <small>MCP URL scoped to this document — add it in claude.ai</small>
            </span>
          </button>
        </div>
      )}
    </span>
  );
}
