"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

// Comment composer anchored in the right margin, outside the sheet,
// vertically aligned with the selected text (Google-Docs style).
export function MarginCommentDraft({
  top,
  onSubmit,
  onCancel,
}: {
  top: number;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow with the content
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  }, [text]);

  const submit = () => {
    const value = text.trim();
    if (value) onSubmit(value);
  };

  return (
    <div className="margin-comment" style={{ top, zIndex: 17 }}>
      <textarea
        ref={textareaRef}
        className="margin-comment-input"
        autoFocus
        rows={2}
        placeholder="Write a comment…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="margin-comment-actions">
        <button
          type="button"
          className="sm-btn"
          title="Add comment"
          aria-label="Add comment"
          onClick={submit}
          disabled={!text.trim()}
        >
          <Check className="size-4" />
        </button>
        <button
          type="button"
          className="sm-btn"
          title="Cancel"
          aria-label="Cancel"
          onClick={onCancel}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
