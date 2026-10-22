"use client";

import { useEffect, useRef, useState } from "react";
import { useDocumentStructure } from "@/lib/useDocumentStructure";
import {
  minimapGeometry,
  scrollForBandDrag,
  scrollForStripClick,
  type MinimapGeometry,
  type MinimapLayout,
  type MinimapViewport,
} from "@/lib/minimap";

// Page scroll and the document root's position on the page
function readViewport(root: HTMLElement, stripHeight: number, scale: number): MinimapViewport {
  return {
    docTop: root.getBoundingClientRect().top + window.scrollY,
    docHeight: root.offsetHeight,
    scrollY: window.scrollY,
    viewportHeight: window.innerHeight,
    maxScroll: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    stripHeight,
    scale,
  };
}

function scrollPageTo(top: number) {
  window.scrollTo({ top, behavior: "instant" });
}

function draw(
  canvas: HTMLCanvasElement,
  layout: MinimapLayout,
  geometry: MinimapGeometry,
  scale: number
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.translate(0, -geometry.offset);

  const visibleTop = geometry.offset;
  const visibleBottom = geometry.offset + height;
  const ink = layout.ink;
  const rect = (x: number, y: number, w: number, h: number, color: string, alpha: number) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };

  const background = /rgba\(.*,\s*0\)$/.test(layout.background) ? "#fff" : layout.background;
  rect(0, 0, width, layout.height * scale, background, 1);

  for (const block of layout.blocks) {
    const x = block.left * scale;
    const y = block.top * scale;
    const w = block.width * scale;
    const h = block.height * scale;
    if (y > visibleBottom || y + h < visibleTop) continue;

    switch (block.kind) {
      case "container":
        rect(x, y, w, h, block.tint ?? ink, 1);
        break;
      case "media":
        rect(x, y, w, Math.max(1, h), ink, 0.16);
        break;
      case "table":
        rect(x, y, w, h, ink, 0.07);
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
        break;
      case "rule":
        rect(x, y + h / 2, w, 1, ink, 0.3);
        break;
      default: {
        // Text, headings, code: one bar per rendered line
        if (block.tint) rect(x, y, w, h, block.tint, 0.7);
        if (block.kind === "code") rect(x, y, w, h, ink, 0.06);
        const lines = block.lines ?? 1;
        const lineHeight = h / lines;
        const heading = block.kind === "heading";
        const thickness = Math.max(1, Math.min(lineHeight * (heading ? 0.7 : 0.55), heading ? 4 : 2.5));
        for (let i = 0; i < lines; i++) {
          const last = i === lines - 1;
          const barWidth = last ? w * (block.lastLine ?? 1) : w;
          rect(x, y + i * lineHeight + (lineHeight - thickness) / 2, barWidth, thickness, ink, heading ? 0.75 : 0.32);
        }
      }
    }
  }

  for (const marker of layout.markers) {
    const y = marker.top * scale;
    if (y > visibleBottom || y < visibleTop - 4) continue;
    if (marker.kind === "comment") rect(width - 4, y - 1, 4, 4, marker.color, 1);
    else rect(0, y - 1, width, 2, marker.color, 0.9);
  }
  ctx.globalAlpha = 1;
}

// VS Code-style overview of the whole document at the viewport's right
// edge: an abstract drawing (bars for text, boxes for media) with the
// visible region as a band that can be dragged, plus comment and
// collaborator-cursor marks. Clicking anywhere centers the page there.
export function DocumentMinimap({
  root,
  markers,
  hasToolbar,
}: {
  root: HTMLElement | null;
  markers: boolean;
  hasToolbar: boolean;
}) {
  const { layout } = useDocumentStructure(root, { layout: true, markers });
  const stripRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strip, setStrip] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<MinimapViewport | null>(null);
  const [dragging, setDragging] = useState(false);

  const scale = layout && layout.width > 0 ? strip.width / layout.width : 0;

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setStrip({ width: el.clientWidth, height: el.clientHeight })
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Follows the page scroll (and re-reads it whenever the document's
  // layout or the strip changes)
  useEffect(() => {
    if (!root || !scale) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setViewport(readViewport(root, strip.height, scale));
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
  }, [root, scale, strip.height, layout]);

  const geometry = viewport ? minimapGeometry(viewport) : null;

  useEffect(() => {
    if (canvasRef.current && layout && geometry && scale) {
      draw(canvasRef.current, layout, geometry, scale);
    }
  });

  // Pressing on the band drags it; pressing elsewhere first jumps there
  // and then keeps dragging from the new position (as in VS Code)
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!root || !scale || !geometry || event.button !== 0) return;
    event.preventDefault();
    const stripTop = event.currentTarget.getBoundingClientRect().top;
    const y = event.clientY - stripTop;
    let start = readViewport(root, strip.height, scale);
    const onBand = y >= geometry.bandTop && y <= geometry.bandTop + geometry.bandHeight;
    if (!onBand) {
      scrollPageTo(scrollForStripClick(start, y));
      start = readViewport(root, strip.height, scale);
    }
    const startY = event.clientY;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    setDragging(true);
    const onMove = (move: PointerEvent) =>
      scrollPageTo(scrollForBandDrag(start, start.scrollY, move.clientY - startY));
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      setDragging(false);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  return (
    <aside
      className={hasToolbar ? "doc-minimap" : "doc-minimap doc-minimap--no-toolbar"}
      aria-label="Document minimap"
    >
      <div className="doc-minimap-strip" ref={stripRef} onPointerDown={onPointerDown}>
        <canvas
          ref={canvasRef}
          className="doc-minimap-canvas"
          style={{ height: geometry?.contentHeight ?? 0 }}
          aria-hidden
        />
        {geometry && (
          <div
            className={dragging ? "doc-minimap-band doc-minimap-band--dragging" : "doc-minimap-band"}
            style={{ top: geometry.bandTop, height: geometry.bandHeight }}
          />
        )}
      </div>
    </aside>
  );
}
