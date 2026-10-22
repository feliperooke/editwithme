"use client";

import { useEffect, useState } from "react";

// Below this width the side panels have no room next to the document:
// they always start hidden and only open as temporary overlays.
const NARROW_QUERY = "(max-width: 899px)";

type Stored = "open" | "closed" | null;

const storageKey = (panel: string) => `html-docs-panel-${panel}`;

function readStored(panel: string): Stored {
  try {
    const value = localStorage.getItem(storageKey(panel));
    return value === "open" || value === "closed" ? value : null;
  } catch {
    return null;
  }
}

// Narrow screens ignore the stored choice (and never write it), so
// opening a panel on a phone doesn't change it on the desktop. Elsewhere
// an explicit choice wins over the panel's default.
export function resolvePanelOpen({
  narrow,
  temporary,
  stored,
  defaultOpen,
}: {
  narrow: boolean;
  temporary: boolean | null;
  stored: Stored;
  defaultOpen: boolean;
}): boolean {
  if (narrow) return temporary ?? false;
  if (stored) return stored === "open";
  return defaultOpen;
}

// Visibility of an editor side panel: per person and global (every
// document), kept in localStorage — never in the shared Yjs document,
// so hiding a panel never hides it for collaborators.
export function usePanelPreference(panel: string, defaultOpen: boolean) {
  const [stored, setStored] = useState<Stored>(() => readStored(panel));
  const [narrow, setNarrow] = useState(
    () => window.matchMedia(NARROW_QUERY).matches
  );
  const [temporary, setTemporary] = useState<boolean | null>(null);

  useEffect(() => {
    const media = window.matchMedia(NARROW_QUERY);
    const onChange = () => {
      setNarrow(media.matches);
      setTemporary(null);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const open = resolvePanelOpen({ narrow, temporary, stored, defaultOpen });

  const setOpen = (next: boolean) => {
    if (narrow) {
      setTemporary(next);
      return;
    }
    const value = next ? "open" : "closed";
    setStored(value);
    try {
      localStorage.setItem(storageKey(panel), value);
    } catch {
      // storage unavailable: the choice lasts for this page only
    }
  };

  return { open, setOpen, toggle: () => setOpen(!open), narrow };
}
