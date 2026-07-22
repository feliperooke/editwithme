"use client";

import { useEffect, useState } from "react";
import { History, X } from "lucide-react";

const ANIM_MS = 260;

export interface VersionEntry {
  at: number;
  size: number;
}

function versionLabel(at: number) {
  return new Date(at).toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Right-side sheet listing the document's automatic version history.
// Clicking a version previews it in the document area; "Current
// version" returns to the live document.
export function HistorySheet({
  docId,
  previewAt,
  onPreview,
  onClose,
}: {
  docId: string;
  previewAt: number | null;
  onPreview: (at: number | null) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<VersionEntry[] | null>(null);
  // Enter/exit animation: mount closed, flip open next frame; on close
  // play the exit transition before unmounting via onClose
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const close = () => {
    setEntered(false);
    window.setTimeout(onClose, ANIM_MS);
  };

  useEffect(() => {
    let alive = true;
    void fetch(`/api/documents/${docId}/versions`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: VersionEntry[]) => {
        if (alive) setVersions(list);
      })
      .catch(() => {
        if (alive) setVersions([]);
      });
    return () => {
      alive = false;
    };
  }, [docId]);

  return (
    <>
      <aside className={`history-sheet${entered ? " history-sheet-in" : ""}`}>
        <div className="history-sheet-header">
          <History className="size-4" aria-hidden />
          <span>Version history</span>
          <button
            type="button"
            className="dialog-close history-sheet-close"
            aria-label="Close history"
            onClick={close}
          >
            <X />
          </button>
        </div>
        <div className="history-sheet-list">
          <button
            type="button"
            className={`history-item${previewAt === null ? " history-item-active" : ""}`}
            onClick={() => onPreview(null)}
          >
            <span className="history-item-title">Current version</span>
            <small>Live document</small>
          </button>
          {versions === null && <p className="history-empty">Loading…</p>}
          {versions !== null && versions.length === 0 && (
            <p className="history-empty">
              No versions yet — snapshots are captured automatically as the
              document is edited.
            </p>
          )}
          {versions?.map((version) => (
            <button
              key={version.at}
              type="button"
              className={`history-item${previewAt === version.at ? " history-item-active" : ""}`}
              onClick={() => onPreview(version.at)}
            >
              <span className="history-item-title">
                {versionLabel(version.at)}
              </span>
              <small>{(version.size / 1024).toFixed(1)} KB</small>
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}
