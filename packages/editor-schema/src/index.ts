import StarterKit from "@tiptap/starter-kit";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import { Extension, Mark, Node } from "@tiptap/core";
import type { Extensions } from "@tiptap/core";

// Generic block container: keeps the structure of uploaded HTML
// documents (layout wrappers AND semantic elements) instead of
// flattening it. The original tag name is preserved in an internal
// attribute so the document's CSS selectors (aside {...}, nav a {...})
// keep matching in the editor and in exports.
const BLOCK_CONTAINER_TAGS = [
  "div",
  "section",
  "article",
  "aside",
  "nav",
  "main",
  "header",
  "footer",
  "figure",
  "figcaption",
  "hgroup",
  "address",
  "details",
  "summary",
];

const Div = Node.create({
  name: "div",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      // Internal: which tag this container renders as (not an HTML
      // attribute — rendered: false keeps it out of the output)
      tag: { default: "div", rendered: false },
    };
  },
  parseHTML() {
    return BLOCK_CONTAINER_TAGS.map((tag) => ({
      tag,
      getAttrs: () => ({ tag }),
    }));
  },
  renderHTML({ node, HTMLAttributes }) {
    const tag = BLOCK_CONTAINER_TAGS.includes(String(node.attrs.tag))
      ? String(node.attrs.tag)
      : "div";
    return [tag, HTMLAttributes, 0];
  },
});

// Bold/italic preserving the ORIGINAL tag: uploaded documents style
// <b>/<i> directly in their CSS (b { display:block } etc.) — silently
// normalizing to <strong>/<em> breaks those selectors. The tag is an
// internal mark attribute; new formatting still produces the default.
const TagBold = Bold.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tag: { default: "strong", rendered: false },
    };
  },
  parseHTML() {
    return [
      { tag: "strong" },
      { tag: "b", getAttrs: () => ({ tag: "b" }) },
    ];
  },
  renderHTML({ mark, HTMLAttributes }) {
    return [mark.attrs.tag === "b" ? "b" : "strong", HTMLAttributes, 0];
  },
});

const TagItalic = Italic.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tag: { default: "em", rendered: false },
    };
  },
  parseHTML() {
    return [
      { tag: "em" },
      { tag: "i", getAttrs: () => ({ tag: "i" }) },
    ];
  },
  renderHTML({ mark, HTMLAttributes }) {
    return [mark.attrs.tag === "i" ? "i" : "em", HTMLAttributes, 0];
  },
});

// Generic <span> as a mark, for inline styles from the original document.
const Span = Mark.create({
  name: "span",
  parseHTML() {
    // Comment spans are handled by the Comment mark below
    return [{ tag: "span:not([data-comment-id])" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  },
});

// Collaborative comment anchored to a text range. All data lives in
// data-comment-* attributes, so comments sync through Yjs and persist
// in the stored HTML with no extra infrastructure. Exports strip them
// (they are collaboration metadata, not document content).
function commentAttribute(attr: string) {
  return {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => element.getAttribute(attr),
    renderHTML: (attributes: Record<string, string | null>) => {
      const value = attributes[attr];
      return value && value !== "null" ? { [attr]: value } : {};
    },
  };
}

const Comment = Mark.create({
  name: "comment",
  priority: 1001,
  inclusive: false,
  // Comments may overlap: two comment marks with different attrs can
  // coexist on the same text (nested spans). The translucent background
  // then stacks, rendering overlaps in a darker shade.
  excludes: "",
  addAttributes() {
    return {
      "data-comment-id": commentAttribute("data-comment-id"),
      "data-comment-author": commentAttribute("data-comment-author"),
      "data-comment-text": commentAttribute("data-comment-text"),
      "data-comment-created-at": commentAttribute("data-comment-created-at"),
      // Edit history: JSON array of previous versions
      // [{ author, text, at }, ...] plus who made the latest edit —
      // travels through Yjs/HTML like every other comment attribute
      "data-comment-history": commentAttribute("data-comment-history"),
      "data-comment-edited-by": commentAttribute("data-comment-edited-by"),
      "data-comment-edited-at": commentAttribute("data-comment-edited-at"),
    };
  },
  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  },
});

// Inline SVG: captures the full <svg> markup as an atom and re-renders
// it verbatim (diagrams and icons from uploaded documents).
// Requires a global `document` in both browser and server (happy-dom).
const InlineSvg = Node.create({
  name: "inlineSvg",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      content: { default: "", rendered: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: "svg",
        getAttrs: (element) => ({
          content: (element as HTMLElement).outerHTML,
        }),
      },
    ];
  },
  renderHTML({ node }) {
    const wrapper = document.createElement("span");
    wrapper.innerHTML = String(node.attrs.content ?? "");
    const svg = wrapper.firstElementChild;
    if (svg) return { dom: svg as HTMLElement };
    return ["span", {}];
  },
});

const ATTRIBUTE_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "image",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "div",
  "span",
  "link",
  "bold",
  "italic",
  "strike",
  "underline",
  "highlight",
  "code",
];

function preservedAttribute(name: string) {
  return {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => element.getAttribute(name),
    // y-prosemirror serializes null mark attributes as the string
    // "null"; this guard keeps that from leaking into the final HTML.
    renderHTML: (attributes: Record<string, string | null>) => {
      const value = attributes[name];
      return value && value !== "null" ? { [name]: value } : {};
    },
  };
}

function preservedAttributes(names: string[]) {
  return Object.fromEntries(
    names.map((name) => [name, preservedAttribute(name)])
  );
}

// Preserves class/style/id from the original HTML through the
// HTML -> editor -> HTML round-trip, so the document CSS keeps working.
// Tables also keep their classic presentational attributes
// (border, cellpadding, width, bgcolor...).
const PreserveAttributes = Extension.create({
  name: "preserveAttributes",
  addGlobalAttributes() {
    return [
      {
        types: ATTRIBUTE_TYPES,
        attributes: preservedAttributes(["class", "style", "id"]),
      },
      {
        types: ["table"],
        attributes: preservedAttributes([
          "border",
          "cellpadding",
          "cellspacing",
          "width",
          "height",
          "align",
          "bgcolor",
        ]),
      },
      {
        types: ["tableRow"],
        attributes: preservedAttributes(["align", "valign", "bgcolor", "height"]),
      },
      {
        types: ["tableCell", "tableHeader"],
        attributes: preservedAttributes([
          "width",
          "height",
          "align",
          "valign",
          "bgcolor",
          "scope",
        ]),
      },
    ];
  },
});

// Tab handling: keep focus inside the editor instead of moving it to
// the next focusable element (the browser default). Inside a list Tab
// nests the item and Shift-Tab lifts it; elsewhere Tab inserts a tab
// character. Returning true tells ProseMirror the key was handled,
// which also calls preventDefault.
const TabIndent = Extension.create({
  name: "tabIndent",
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.commands.sinkListItem("listItem")) return true;
        return this.editor.commands.insertContent("\t");
      },
      "Shift-Tab": () => {
        if (this.editor.commands.liftListItem("listItem")) return true;
        // Nothing to outdent: swallow the key so focus stays put
        return true;
      },
    };
  },
});

// History disabled: in collaborative mode undo/redo comes from Yjs
// (Collaboration extension). The server uses the same extensions to
// convert HTML <-> editor state.
export const baseExtensions: Extensions = [
  StarterKit.configure({ history: false, bold: false, italic: false }),
  TagBold,
  TagItalic,
  Underline,
  Link.configure({ openOnClick: false, autolink: true }),
  Image.configure({ allowBase64: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Highlight.configure({ multicolor: true }),
  Div,
  Span,
  Comment,
  InlineSvg,
  PreserveAttributes,
  TabIndent,
];
