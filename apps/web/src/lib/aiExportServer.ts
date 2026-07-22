import { JSDOM } from "jsdom";
import { buildAiExport, type AiExportMode } from "@/lib/aiExport";

// Server-side wrapper for the "Export for AI" builder (it uses
// DOMParser, a browser API). jsdom, not happy-dom: happy-dom's parser
// switches to raw-text mode on <style> inside <svg> (Excalidraw
// exports have one in <defs>) and silently swallows the rest of the
// document. The global exists only during the synchronous build,
// mirroring materialize.ts.
const jsdomWindow = new JSDOM("").window;

export function buildAiExportServer(input: {
  title: string;
  bodyHtml: string;
  mode?: AiExportMode;
}): string {
  const g = globalThis as { DOMParser?: unknown };
  const had = "DOMParser" in g;
  const previous = g.DOMParser;
  g.DOMParser = jsdomWindow.DOMParser;
  try {
    return buildAiExport(input);
  } finally {
    if (had) g.DOMParser = previous;
    else delete g.DOMParser;
  }
}
