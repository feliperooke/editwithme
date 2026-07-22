"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Highlighter } from "lucide-react";

export const HIGHLIGHT_COLORS = ["#fff176", "#b9f6ca", "#f8bbd0", "#b3e5fc"];

const HOLD_DELAY_MS = 450;

// Highlight button with press-and-hold color palette:
// - quick click toggles the highlight using the last color picked
// - press and hold opens a 4-color palette
// Used in both the toolbar (palette opens down) and the selection menu
// (palette opens up).
export function HighlightButton({
  editor,
  buttonClassName,
  activeClassName,
  paletteDirection,
}: {
  editor: Editor;
  buttonClassName: string;
  activeClassName: string;
  paletteDirection: "up" | "down";
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [lastColor, setLastColor] = useState(HIGHLIGHT_COLORS[0]);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const holdTimer = useRef<number | null>(null);
  const heldRef = useRef(false);

  const cancelHold = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const startHold = () => {
    heldRef.current = false;
    cancelHold();
    holdTimer.current = window.setTimeout(() => {
      heldRef.current = true;
      setPaletteOpen(true);
    }, HOLD_DELAY_MS);
  };

  const onClick = () => {
    // A long press already opened the palette; swallow the click
    if (heldRef.current) {
      heldRef.current = false;
      return;
    }
    editor.chain().focus().toggleHighlight({ color: lastColor }).run();
  };

  const applyColor = (color: string) => {
    setLastColor(color);
    editor.chain().focus().setHighlight({ color }).run();
    setPaletteOpen(false);
  };

  // Close the palette on any press outside of it
  useEffect(() => {
    if (!paletteOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setPaletteOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [paletteOpen]);

  const active = editor.isActive("highlight");

  return (
    <span className="highlight-button-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`${buttonClassName}${active ? ` ${activeClassName}` : ""}`}
        title="Highlight — hold for colors"
        aria-label="Highlight"
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onClick={onClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Highlighter className="size-4" />
      </button>
      {paletteOpen && (
        <div className={`highlight-palette highlight-palette--${paletteDirection}`}>
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className="highlight-swatch"
              style={{ background: color }}
              title={color}
              aria-label={`Highlight ${color}`}
              onClick={() => applyColor(color)}
            />
          ))}
        </div>
      )}
    </span>
  );
}
