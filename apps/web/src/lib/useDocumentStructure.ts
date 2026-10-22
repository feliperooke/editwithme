"use client";

import { useEffect, useState } from "react";
import { collectHeadings, sameHeadings, type OutlineHeading } from "@/lib/outline";
import { measureDocument, type MinimapLayout } from "@/lib/minimap";

export interface DocumentStructure {
  headings: OutlineHeading[];
  /** Measured picture for the minimap; null unless requested */
  layout: MinimapLayout | null;
}

const EMPTY: DocumentStructure = { headings: [], layout: null };

// Structure of the document as RENDERED: reads the DOM under `root`
// rather than the ProseMirror state, so the same source serves the live
// editor and the version preview (raw HTML), with positions laid out by
// the document's own CSS. Local and remote edits, font/image loads and
// resizes all surface as DOM mutations or size changes; they are batched
// into a single recompute per animation frame.
//
// `layout` (block geometry, plus comment/cursor markers when `markers`)
// changes on nearly every edit, so only the minimap asks for it — the
// component that requests it is the one that re-renders.
export function useDocumentStructure(
  root: HTMLElement | null,
  { layout = false, markers = false }: { layout?: boolean; markers?: boolean } = {}
): DocumentStructure {
  const [structure, setStructure] = useState<DocumentStructure>(EMPTY);

  useEffect(() => {
    if (!root) {
      setStructure(EMPTY);
      return;
    }
    let frame = 0;
    const recompute = () => {
      frame = 0;
      const headings = collectHeadings(root);
      const measured = layout ? measureDocument(root, { markers }) : null;
      // Cursor widgets mutate the DOM on every keystroke of every peer;
      // without a layout to refresh, only publish when the outline changed
      setStructure((previous) => {
        const sameOutline = sameHeadings(previous.headings, headings);
        if (sameOutline && !layout) return previous;
        return { headings: sameOutline ? previous.headings : headings, layout: measured };
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(recompute);
    };

    const mutations = new MutationObserver(schedule);
    mutations.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      // Comment marks and highlight colors change by attribute
      attributes: layout,
    });
    const resizes = new ResizeObserver(schedule);
    resizes.observe(root);
    recompute();

    return () => {
      mutations.disconnect();
      resizes.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [root, layout, markers]);

  return structure;
}
