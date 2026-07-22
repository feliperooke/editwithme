"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Check, History, SquarePen, Trash2, X } from "lucide-react";

interface CommentVersion {
  author: string;
  text: string;
  at: string;
}

function parseHistory(raw: string | null | undefined): CommentVersion[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface MarginCommentInfo {
  id: string;
  top: number;
  attrs: Record<string, string | null>;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// All document comments as always-visible cards in the right margin,
// aligned with their text. Cards are laid out top-down and pushed below
// the previous one when they would overlap (Google-Docs style).
// Each card can be edited in place.
export function CommentsMargin({
  comments,
  activeId,
  onRemove,
  onEdit,
  readOnly = false,
}: {
  comments: MarginCommentInfo[];
  activeId: string | null;
  onRemove: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  readOnly?: boolean;
}) {
  const refs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Cards with their edit history expanded (collapsed by default)
  const [historyOpen, setHistoryOpen] = useState<Set<string>>(new Set());
  const toggleHistory = (id: string) =>
    setHistoryOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Focus/blur changes the expanded state via CSS only; this bump makes
  // React re-run the layout pass so cards below reflow accordingly
  const [, bumpLayout] = useState(0);
  const relayout = () => bumpLayout((n) => n + 1);

  useLayoutEffect(() => {
    // Pass 1: mark comments taller than 5 lines as collapsible (the
    // measurement happens unclamped, then the class re-applies)
    const maxLines = 5;
    for (const comment of comments) {
      const element = refs.current.get(comment.id);
      const text = element?.querySelector<HTMLElement>(".comment-text");
      if (!text) continue;
      text.classList.remove("comment-text--collapsible");
      const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 19;
      if (text.scrollHeight > maxLines * lineHeight + 2) {
        text.classList.add("comment-text--collapsible");
      }
    }
    // Pass 1.5: the edit textarea grows to fit its content (opens at
    // full comment height and expands as new lines are added)
    if (editingId) {
      const textarea = refs.current
        .get(editingId)
        ?.querySelector<HTMLTextAreaElement>(".margin-comment-input");
      if (textarea) {
        textarea.style.height = "auto";
        textarea.style.height = `${textarea.scrollHeight + 2}px`;
      }
    }
    // Pass 2: stack cards top-down without overlaps
    let previousBottom = -Infinity;
    for (const comment of comments) {
      const element = refs.current.get(comment.id);
      if (!element) continue;
      const top = Math.max(comment.top, previousBottom + 8);
      element.style.top = `${top}px`;
      previousBottom = top + element.offsetHeight;
    }
  });

  const startEdit = (comment: MarginCommentInfo) => {
    setEditingId(comment.id);
    setDraft(comment.attrs["data-comment-text"] ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft("");
  };

  const saveEdit = (id: string) => {
    const text = draft.trim();
    if (!text) return;
    onEdit(id, text);
    cancelEdit();
  };

  return (
    <>
      {comments.map((comment) => {
        const editing = comment.id === editingId;
        return (
          <div
            key={comment.id}
            ref={(element) => {
              if (element) refs.current.set(comment.id, element);
              else refs.current.delete(comment.id);
            }}
            className={`margin-comment${
              comment.id === activeId ? " margin-comment--active" : ""
            }`}
            style={{ top: comment.top }}
            tabIndex={0}
            onFocus={relayout}
            onBlur={relayout}
          >
            <div className="comment-card-header">
              <span className="comment-author">
                {comment.attrs["data-comment-author"] || "Anonymous"}
              </span>
              <span className="comment-date">
                {formatDate(comment.attrs["data-comment-created-at"])}
              </span>
              {!editing && !readOnly && (
                <span className="comment-card-actions">
                  <button
                    type="button"
                    className="sm-btn"
                    title="Edit comment"
                    aria-label="Edit comment"
                    onClick={() => startEdit(comment)}
                  >
                    <SquarePen className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="sm-btn"
                    title="Remove comment"
                    aria-label="Remove comment"
                    onClick={() => onRemove(comment.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </span>
              )}
            </div>
            {editing ? (
              <>
                <textarea
                  className="margin-comment-input"
                  autoFocus
                  rows={2}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      saveEdit(comment.id);
                    }
                    if (e.key === "Escape") cancelEdit();
                  }}
                />
                <div className="margin-comment-actions">
                  <button
                    type="button"
                    className="sm-btn"
                    title="Save"
                    aria-label="Save"
                    onClick={() => saveEdit(comment.id)}
                    disabled={!draft.trim()}
                  >
                    <Check className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="sm-btn"
                    title="Cancel"
                    aria-label="Cancel"
                    onClick={cancelEdit}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="comment-text">
                  {comment.attrs["data-comment-text"]}
                </p>
                {(() => {
                  const history = parseHistory(
                    comment.attrs["data-comment-history"]
                  );
                  if (history.length === 0) return null;
                  const open = historyOpen.has(comment.id);
                  const editedBy =
                    comment.attrs["data-comment-edited-by"] || "Anonymous";
                  return (
                    <>
                      <button
                        type="button"
                        className="comment-history-toggle"
                        onClick={() => toggleHistory(comment.id)}
                      >
                        <History className="size-3" aria-hidden />
                        Edited by {editedBy} ·{" "}
                        {history.length === 1
                          ? "1 version"
                          : `${history.length} versions`}
                      </button>
                      {open && (
                        <div className="comment-history">
                          {[...history].reverse().map((version, index) => (
                            <div
                              key={index}
                              className="comment-history-entry"
                            >
                              <span className="comment-history-meta">
                                {version.author || "Anonymous"}
                                {version.at ? ` · ${formatDate(version.at)}` : ""}
                              </span>
                              <span className="comment-history-text">
                                {version.text}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}
