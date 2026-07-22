import * as Y from "yjs";
import { getSchema } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import {
  DOMParser as PmDOMParser,
  DOMSerializer,
  Node,
} from "@tiptap/pm/model";
import { TiptapTransformer } from "@hocuspocus/transformer";
import { prosemirrorToYXmlFragment } from "y-prosemirror";
import { JSDOM } from "jsdom";
import { baseExtensions } from "@html-editor/editor-schema";

// Server-side Yjs <-> HTML conversion for the checkpoint endpoints.
// jsdom on BOTH directions — not zeed-dom (@tiptap/html's generateJSON)
// and not happy-dom: their parsers mishandle <style> inside <svg> and
// silently drop the SVG's remaining content. That bites parsing the
// document AND serializing it (InlineSvg's renderHTML re-parses the
// stored markup via innerHTML). jsdom parses foreign content per spec
// and supports style.cssText, which ProseMirror's DOMSerializer needs.
const jsdomWindow = new JSDOM("").window;

function htmlToPmNode(html: string): Node {
  const schema = getSchema(baseExtensions);
  const dom = new jsdomWindow.DOMParser().parseFromString(
    `<body>${html || "<p></p>"}</body>`,
    "text/html"
  );
  return PmDOMParser.fromSchema(schema).parse(dom.body);
}

// The schema's InlineSvg renderHTML needs a global `document`, but a
// PERMANENT global document makes Next's SSR code believe it runs in a
// browser and touch `window` ("window is not defined" crashes). The
// global therefore exists only during the synchronous serialization
// below and is restored immediately after.
function withGlobalDocument<T>(fn: () => T): T {
  const g = globalThis as { document?: unknown };
  const had = "document" in g;
  const previous = g.document;
  g.document = jsdomWindow.document;
  try {
    return fn();
  } finally {
    if (had) g.document = previous;
    else delete g.document;
  }
}

function jsonToHtml(json: JSONContent): string {
  return withGlobalDocument(() => {
    const schema = getSchema(baseExtensions);
    const contentNode = Node.fromJSON(schema, json);
    const document = jsdomWindow.document as unknown as Document;
    const fragment = DOMSerializer.fromSchema(schema).serializeFragment(
      contentNode.content,
      { document }
    );
    const container = document.createElement("div");
    container.appendChild(fragment);
    return container.innerHTML;
  });
}

export function ydocToHtml(ydoc: Y.Doc): string {
  const json = TiptapTransformer.fromYdoc(ydoc, "default");
  return jsonToHtml(json);
}

// Builds a Y.Doc from a stored update blob, or seeds one from HTML when
// the document has no Yjs state yet (same rule as the collab server).
export function loadYdoc(
  storedUpdate: Uint8Array | null,
  html: string
): Y.Doc {
  if (storedUpdate && storedUpdate.length > 0) {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, storedUpdate);
    return ydoc;
  }
  const json = htmlToPmNode(html).toJSON() as JSONContent;
  return TiptapTransformer.toYdoc(json, "default", baseExtensions);
}

// Replaces the document content with new HTML as a MINIMAL CRDT delta:
// prosemirrorToYXmlFragment diffs the new content against the existing
// fragment in place (no delete-all first — that would turn every
// revision into a full rewrite). A one-paragraph change produces a
// ~40-byte delta instead of a document-sized one, live tabs only
// re-render the touched nodes, and concurrent edits to other parts of
// the document survive the merge.
export function replaceContentAsUpdate(ydoc: Y.Doc, html: string): Uint8Array {
  const before = Y.encodeStateVector(ydoc);
  const pmNode = htmlToPmNode(html);
  const fragment = ydoc.getXmlFragment("default");
  ydoc.transact(() => {
    prosemirrorToYXmlFragment(pmNode, fragment);
  });
  return Y.encodeStateAsUpdate(ydoc, before);
}
