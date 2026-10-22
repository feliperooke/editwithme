"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { activeHeadingIndex, type OutlineHeading } from "@/lib/outline";

// Breathing room between the sticky chrome and a heading scrolled to
const SCROLL_GAP = 16;

// Bottom edge of the sticky toolbar ONCE STUCK (absent in view-only
// mode): headings scrolled to land just below it instead of underneath
// the glass. Its current rect is no good near the top of the page, where
// the toolbar still sits lower, below the header.
function stickyChromeBottom(): number {
  const toolbar = document.querySelector<HTMLElement>(".toolbar");
  if (!toolbar) return 0;
  return (parseFloat(getComputedStyle(toolbar).top) || 0) + toolbar.offsetHeight;
}

function scrollToHeading(el: HTMLElement) {
  const top =
    el.getBoundingClientRect().top + window.scrollY - stickyChromeBottom() - SCROLL_GAP;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
}

// Navigable table of contents built from the document's headings.
// Navigation only scrolls: the caret and selection stay put, so the
// user's collaborative cursor doesn't jump in front of their peers.
export function DocumentOutline({
  headings,
  hasToolbar,
  onNavigate,
  onClose,
}: {
  headings: OutlineHeading[];
  hasToolbar: boolean;
  onNavigate?: () => void;
  onClose: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // Scrollspy: the section in view is highlighted
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const tops = headings.map((h) => h.el.getBoundingClientRect().top);
      setActiveIndex(activeHeadingIndex(tops, stickyChromeBottom() + SCROLL_GAP * 2));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    update();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [headings]);

  // A long outline follows the reading position. Adjusts the list's own
  // scrollTop: scrollIntoView could also scroll the page itself.
  useEffect(() => {
    const list = listRef.current;
    if (!list || activeIndex === null) return;
    const item = list.children[activeIndex] as HTMLElement | undefined;
    if (!item) return;
    if (item.offsetTop < list.scrollTop) {
      list.scrollTop = item.offsetTop;
    } else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  }, [activeIndex]);

  return (
    <nav
      className={hasToolbar ? "doc-outline" : "doc-outline doc-outline--no-toolbar"}
      aria-label="Document outline"
    >
      <div className="doc-outline-panel">
        <div className="doc-outline-header">
          <span className="doc-outline-title">Outline</span>
          <button
            type="button"
            className="sm-btn"
            aria-label="Hide outline"
            title="Hide outline"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        {headings.length === 0 ? (
          <p className="doc-outline-empty">Headings you add will appear here.</p>
        ) : (
          <ol className="doc-outline-list" ref={listRef}>
            {headings.map((heading, i) => (
              <li key={i}>
                <button
                  type="button"
                  className={[
                    "doc-outline-item",
                    heading.depth === 0 ? "doc-outline-item--root" : "",
                    i === activeIndex ? "doc-outline-item--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ paddingLeft: 10 + heading.depth * 14 }}
                  aria-current={i === activeIndex ? "location" : undefined}
                  title={heading.text}
                  onClick={() => {
                    scrollToHeading(heading.el);
                    onNavigate?.();
                  }}
                >
                  {heading.text}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </nav>
  );
}
