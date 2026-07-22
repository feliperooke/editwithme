"use client";

import { useEffect, useRef, useState } from "react";
import { FileDown, FolderOpen, Menu, RotateCcw, Save } from "lucide-react";

// Hamburger file menu at the left edge of the editor header:
// Open (import an HTML file as a new document), Save to (download the
// current document as HTML), Export as PDF. Same popover pattern and
// styling as ShareMenu, anchored to the left.
export function FileMenu({
  onOpenFile,
  onSaveHtml,
  onExportPdf,
  onResetDocument,
  pdfState,
}: {
  onOpenFile: (file: File) => void;
  onSaveHtml: () => void;
  onExportPdf: () => void;
  onResetDocument: () => void;
  pdfState: "idle" | "loading" | "error";
}) {
  const [open, setOpen] = useState(false);
  // Destructive action: first click arms it, second click confirms
  const [confirmReset, setConfirmReset] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setConfirmReset(false);
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <span className="share-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`file-menu-trigger${open ? " file-menu-trigger-open" : ""}`}
        aria-label="File menu"
        title="File menu"
        onClick={() => setOpen((o) => !o)}
      >
        <Menu className="size-5" />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".html,.htm,text/html"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onOpenFile(file);
          e.target.value = "";
        }}
      />
      {open && (
        <div className="share-menu share-menu-left">
          <button
            type="button"
            className="share-menu-item"
            onClick={() => {
              setOpen(false);
              fileInputRef.current?.click();
            }}
          >
            <FolderOpen className="size-4" />
            <span>
              Open…
              <small>Import an HTML file as a new document</small>
            </span>
          </button>
          <button
            type="button"
            className="share-menu-item"
            onClick={() => {
              setOpen(false);
              onSaveHtml();
            }}
          >
            <Save className="size-4" />
            <span>
              Save to…
              <small>Download the document as an HTML file</small>
            </span>
          </button>
          <button
            type="button"
            className="share-menu-item"
            onClick={() => {
              setOpen(false);
              onExportPdf();
            }}
            disabled={pdfState === "loading"}
          >
            <FileDown className="size-4" />
            <span>
              {pdfState === "loading"
                ? "Generating PDF…"
                : pdfState === "error"
                  ? "PDF failed — try again"
                  : "Export as PDF"}
              <small>Rendered with the document&apos;s print styles</small>
            </span>
          </button>
          <button
            type="button"
            className={`share-menu-item${confirmReset ? " share-menu-item-danger" : ""}`}
            onClick={() => {
              if (!confirmReset) {
                setConfirmReset(true);
                return;
              }
              setConfirmReset(false);
              setOpen(false);
              onResetDocument();
            }}
          >
            <RotateCcw className="size-4" />
            <span>
              {confirmReset ? "Click again to confirm" : "Reset Document"}
              <small>
                {confirmReset
                  ? "This clears the whole document (Ctrl/Cmd+Z undoes)"
                  : "Clear all content and start blank"}
              </small>
            </span>
          </button>
        </div>
      )}
    </span>
  );
}
