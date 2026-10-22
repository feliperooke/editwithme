// The minimap's model of the document: an abstract picture (bars for
// text, boxes for media) measured from the rendered DOM, plus the math
// that maps between page scroll and the minimap strip. Measurement reads
// the DOM; the geometry functions below it are pure.

export type MinimapBlockKind =
  | "container" // a layout wrapper with its own background
  | "text"
  | "heading"
  | "code"
  | "media"
  | "table"
  | "rule";

export interface MinimapBlock {
  kind: MinimapBlockKind;
  // Document coordinates: px from the top/left of the measured root
  top: number;
  left: number;
  width: number;
  height: number;
  /** Text blocks: number of rendered lines */
  lines?: number;
  /** Text blocks: width of the last line as a fraction of the block */
  lastLine?: number;
  /** Container background, or highlight color inside a text block */
  tint?: string;
}

export interface MinimapMarker {
  kind: "comment" | "cursor";
  top: number;
  color: string;
}

export interface MinimapLayout {
  width: number;
  height: number;
  /** Page background behind the document */
  background: string;
  /** Text color of the document, used for the bars */
  ink: string;
  blocks: MinimapBlock[];
  markers: MinimapMarker[];
}

const TEXT_SELECTOR = "p, h1, h2, h3, h4, h5, h6, pre";
const MEDIA_SELECTOR = "img, svg, video, iframe, canvas";
const CONTAINER_SELECTOR =
  "div, section, article, aside, nav, main, header, footer, figure, blockquote";
// Editor UI mounted inside the document (cursor carets and their name
// labels) is not document content
const EDITOR_UI_SELECTOR = ".collaboration-cursor__caret";
const COMMENT_COLOR = "rgba(230, 162, 0, 0.95)";
// Background-color lookups cost a style recalc each; documents with
// thousands of wrappers keep only the first ones
const MAX_CONTAINERS = 400;

const isTransparent = (color: string) =>
  color === "transparent" || /rgba\(.*,\s*0\)$/.test(color);

// Abstract stand-in for where a paragraph's last line ends: stable for a
// given text (no flicker while others type elsewhere) but varied enough
// that the bars read as prose rather than a solid block.
function lastLineFraction(text: string): number {
  return 0.3 + 0.65 * (((text.length * 37) % 100) / 100);
}

export function measureDocument(
  root: HTMLElement,
  { markers: withMarkers }: { markers: boolean }
): MinimapLayout {
  const rootRect = root.getBoundingClientRect();
  const box = (el: Element) => {
    const rect = el.getBoundingClientRect();
    return {
      top: rect.top - rootRect.top,
      left: rect.left - rootRect.left,
      width: rect.width,
      height: rect.height,
    };
  };
  const blocks: MinimapBlock[] = [];

  root.querySelectorAll(CONTAINER_SELECTOR).forEach((el, i) => {
    if (i >= MAX_CONTAINERS || el.closest(EDITOR_UI_SELECTOR)) return;
    const background = getComputedStyle(el).backgroundColor;
    if (!isTransparent(background)) {
      blocks.push({ kind: "container", ...box(el), tint: background });
    }
  });

  // Line heights repeat across a document: one style lookup per kind
  const lineHeights = new Map<string, number>();
  const lineHeightOf = (el: Element) => {
    const key = `${el.tagName}.${el.className}`;
    let value = lineHeights.get(key);
    if (value === undefined) {
      const style = getComputedStyle(el);
      value = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 20;
      lineHeights.set(key, value);
    }
    return value;
  };

  root.querySelectorAll(TEXT_SELECTOR).forEach((el) => {
    // Tables are drawn as a whole; their cell paragraphs would be noise
    if (el.closest("table") || el.closest(EDITOR_UI_SELECTOR)) return;
    const text = el.textContent ?? "";
    if (!text.trim()) return;
    const geometry = box(el);
    const highlight = el.querySelector<HTMLElement>("mark");
    blocks.push({
      kind: el.tagName === "PRE" ? "code" : /^H\d$/.test(el.tagName) ? "heading" : "text",
      ...geometry,
      lines: Math.max(1, Math.round(geometry.height / lineHeightOf(el))),
      lastLine: lastLineFraction(text),
      tint: highlight ? highlight.style.backgroundColor || "#fde68a" : undefined,
    });
  });

  root.querySelectorAll(MEDIA_SELECTOR).forEach((el) => {
    // SVGs nested in SVGs, and editor UI, are not separate pictures
    if (el.parentElement?.closest("svg") || el.closest(EDITOR_UI_SELECTOR)) return;
    blocks.push({ kind: "media", ...box(el) });
  });
  root.querySelectorAll("table").forEach((el) => blocks.push({ kind: "table", ...box(el) }));
  root.querySelectorAll("hr").forEach((el) => blocks.push({ kind: "rule", ...box(el) }));

  const markers: MinimapMarker[] = [];
  if (withMarkers) {
    // A comment spanning several nodes renders several spans: mark it once
    const seen = new Set<string>();
    root.querySelectorAll<HTMLElement>("span[data-comment-id]").forEach((el) => {
      const id = el.dataset.commentId ?? "";
      if (seen.has(id)) return;
      seen.add(id);
      markers.push({ kind: "comment", top: box(el).top, color: COMMENT_COLOR });
    });
    root.querySelectorAll<HTMLElement>(EDITOR_UI_SELECTOR).forEach((el) => {
      markers.push({
        kind: "cursor",
        top: box(el).top,
        color: el.style.getPropertyValue("--user-color") || el.style.borderColor || "#1a73e8",
      });
    });
  }

  const sheet = root.closest(".doc-sheet") ?? root;
  return {
    width: rootRect.width,
    height: rootRect.height,
    background: getComputedStyle(sheet).backgroundColor,
    ink: getComputedStyle(root).color,
    blocks,
    markers,
  };
}

// ---------- Geometry (pure) ----------

export interface MinimapViewport {
  /** Page Y of the document root's top edge */
  docTop: number;
  docHeight: number;
  scrollY: number;
  viewportHeight: number;
  /** Largest page scroll (scrollHeight - innerHeight) */
  maxScroll: number;
  stripHeight: number;
  /** Minimap px per document px */
  scale: number;
}

export interface MinimapGeometry {
  /** How far the drawing is scrolled up inside the strip */
  offset: number;
  /** Height the drawing occupies in the strip (≤ stripHeight) */
  contentHeight: number;
  bandTop: number;
  bandHeight: number;
}

// Like VS Code: a document that fits the strip is drawn whole; a taller
// one scrolls inside the strip in proportion to the page scroll, so both
// ends of the document are reachable and the band never leaves the strip.
export function minimapGeometry(v: MinimapViewport): MinimapGeometry {
  const drawnHeight = v.docHeight * v.scale;
  const overflow = Math.max(0, drawnHeight - v.stripHeight);
  const progress = v.maxScroll > 0 ? clamp(v.scrollY / v.maxScroll, 0, 1) : 0;
  const offset = progress * overflow;
  // The band covers the part of the DOCUMENT in view: near the top of
  // the page the viewport also shows the header, which is not drawn
  const visibleTop = Math.max(v.scrollY, v.docTop);
  const visibleBottom = Math.min(v.scrollY + v.viewportHeight, v.docTop + v.docHeight);
  return {
    offset,
    contentHeight: Math.min(drawnHeight, v.stripHeight),
    bandTop: (visibleTop - v.docTop) * v.scale - offset,
    bandHeight: Math.max(0, visibleBottom - visibleTop) * v.scale,
  };
}

// Clicking the strip centers the page on the clicked point
export function scrollForStripClick(v: MinimapViewport, stripY: number): number {
  const { offset } = minimapGeometry(v);
  const docY = (stripY + offset) / v.scale;
  return clamp(v.docTop + docY - v.viewportHeight / 2, 0, v.maxScroll);
}

// Dragging the band keeps it under the pointer. Per pixel of page
// scroll the band moves `scale`, minus the drawing's own scroll inside
// the strip (overflow / maxScroll) — so a pixel of drag is worth the
// inverse of that.
export function scrollForBandDrag(
  v: MinimapViewport,
  startScroll: number,
  dragDelta: number
): number {
  const overflow = Math.max(0, v.docHeight * v.scale - v.stripHeight);
  const bandSpeed = v.scale - (v.maxScroll > 0 ? overflow / v.maxScroll : 0);
  if (bandSpeed <= 0) return startScroll;
  return clamp(startScroll + dragDelta / bandSpeed, 0, v.maxScroll);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
