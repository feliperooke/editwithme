"use client";

import { useEffect, useState } from "react";
import { collectHeadings, sameHeadings, type OutlineHeading } from "@/lib/outline";

export interface DocumentStructure {
  headings: OutlineHeading[];
}

const EMPTY: DocumentStructure = { headings: [] };

// Structure of the document as RENDERED: reads the DOM under `root`
// rather than the ProseMirror state, so the same source serves the live
// editor and the version preview (raw HTML), with positions laid out by
// the document's own CSS. Local and remote edits, font/image loads and
// resizes all surface as DOM mutations or size changes; they are batched
// into a single recompute per animation frame.
export function useDocumentStructure(root: HTMLElement | null): DocumentStructure {
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
      // Cursor widgets mutate the DOM on every keystroke of every peer;
      // only publish a new structure when the outline actually changed
      setStructure((previous) =>
        sameHeadings(previous.headings, headings) ? previous : { headings }
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(recompute);
    };

    const mutations = new MutationObserver(schedule);
    mutations.observe(root, { childList: true, subtree: true, characterData: true });
    const resizes = new ResizeObserver(schedule);
    resizes.observe(root);
    recompute();

    return () => {
      mutations.disconnect();
      resizes.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [root]);

  return structure;
}
