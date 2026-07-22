"use client";

import type { MutableRefObject } from "react";
import { BubbleMenu, posToDOMRect, type Editor } from "@tiptap/react";
import { MessageSquarePlus } from "lucide-react";
import { HighlightButton } from "@/components/HighlightButton";

// Floating menu shown on text selection: comment or highlight actions.
// Comment composing and viewing happen in the right margin
// (MarginCommentDraft / MarginCommentCard).
export function SelectionMenu({
  editor,
  onStartComment,
  draftOpenRef,
}: {
  editor: Editor;
  onStartComment: () => void;
  draftOpenRef: MutableRefObject<boolean>;
}) {
  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{
        duration: 150,
        maxWidth: 380,
        // The menu STARTS at the selection's bottom-right corner and
        // grows rightward: anchor on a zero-width rect at that corner
        placement: "bottom-start",
        // Nudged slightly up and to the left of the corner
        offset: [-6, -2],
        getReferenceClientRect: () => {
          const { from, to } = editor.state.selection;
          const rect = posToDOMRect(editor.view, from, to);
          return new DOMRect(rect.right, rect.bottom, 0, 0);
        },
      }}
      shouldShow={({ editor: e, state }) =>
        e.isEditable &&
        !draftOpenRef.current &&
        !state.selection.empty &&
        !e.isActive("comment")
      }
    >
      <div className="selection-menu">
        <div className="selection-actions">
          <button
            type="button"
            className="sm-btn"
            title="Comment"
            aria-label="Comment"
            onClick={onStartComment}
          >
            <MessageSquarePlus className="size-4" />
          </button>
          <HighlightButton
            editor={editor}
            buttonClassName="sm-btn"
            activeClassName="sm-btn-active"
            paletteDirection="up"
          />
        </div>
      </div>
    </BubbleMenu>
  );
}
