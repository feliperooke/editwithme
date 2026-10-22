# Plan: document outline + minimap

Two new pieces of editor chrome:

- **Outline** — an automatic, navigable table of contents built from the
  document's headings, shown beside the sheet; it can be hidden.
- **Minimap** — a VS Code-style overview of the whole document at the
  viewport's right edge.

Both are 100% client-side and read-only with respect to the document: no
changes to the Tiptap schema, Yjs, the backend, exports or MCP.

## Layout

- **Outline: left of the sheet.** The right margin already belongs to the
  comments column (`.margin-comment`, `left: calc(50% + 437px)`).
- **Minimap: a narrow strip (~80–100px) pinned to the viewport's right
  edge**, beyond the comments column.
- **When there is spare margin** (paper sheet on a wide screen), both sit
  in it without moving the sheet.
- **When there is not** (full-canvas layouts, narrow laptops):
  - the outline becomes a floating glass overlay above the content;
  - the minimap reserves its width in the canvas (it is narrow and
    always on).
- **Below ~900px** both start hidden and only open as overlays.

## Visibility

- **Per person, global** (not per document), stored in `localStorage`.
  Never synced through Yjs: hiding a panel must not hide it for
  collaborators.
- **Defaults** (no stored choice):
  - outline opens if the document has **≥ 2 headings**, otherwise closed;
  - minimap starts visible.
- **An explicit stored choice wins** over the defaults.
- **Narrow screens (< ~900px):** both always start hidden on load, even
  if the stored preference is "open". Opening them there is temporary and
  does **not** overwrite the wide-screen preference.
- **Toggles** live in the editor chrome; keyboard shortcut
  `Ctrl/Cmd+Shift+O` toggles the outline.

## Outline

- **Source:** every `heading` node (h1–h6) in the document, including
  those nested inside `div`/`section` containers. Empty headings are
  skipped. No heuristics (bold paragraphs etc.).
- **Hierarchy:** relative levels — the shallowest heading present is the
  root, and a jump (h2 → h4) indents a single step. Flat indented list,
  no collapse/expand.
- **Click:** smooth-scrolls to the heading, offset for the sticky
  header/toolbar. It does **not** move the caret or selection (that would
  jump the user's collaborative cursor in front of peers).
- **Scrollspy:** the section currently in view is highlighted, and the
  outline scrolls to keep it visible.
- **No URL anchors:** headings have no stable ids in a collaborative
  document, and the URL already carries the edit key.

## Minimap

- **Rendering:** abstract drawing on a `<canvas>` from the real layout
  rects of the rendered blocks:
  - text lines → grey bars;
  - headings → darker, thicker bars;
  - images/tables → blocks;
  - background colors and highlights → tinted.

  Cheap enough to redraw on every change without hurting typing, and
  works for full-canvas layouts too. Rejected: a scaled DOM clone (heavy
  second DOM) and screenshots (html2canvas: slow, breaks on fonts/SVG).
- **Viewport slider:** a translucent band showing the visible region;
  draggable to scroll, and clicking anywhere centers the page there.
- **Overlays:**
  - comment ticks, reusing the comment positions the margin already
    computes;
  - collaborator cursor ticks in each user's color (from awareness).
- **Scale:** fixed (~1:8). When the document is taller than the strip at
  that scale, the minimap scrolls along with the document, like VS Code,
  instead of squashing it.
- **Out of scope:** hover text previews, search results, version diff
  marks.

## Modes

- **View-only (`/doc/<id>`):** both work the same — there are no editing
  actions in them.
- **Version preview:** both reflect the displayed snapshot; the minimap
  shows no comments or cursors (they belong to the live document).
- **Export (HTML/PDF) and MCP:** nothing from either panel is included.
  An "insert table of contents into the document" feature would be
  separate.

## Architecture

- **`useDocumentStructure(root)`** reads the **rendered DOM**, not the
  ProseMirror state, so a single source serves both the live editor and
  the version preview (raw HTML), with real positions under the
  document's own CSS.
  - Returns
    `{ headings: [{ level, text, top, el }], blocks: [{ top, height, kind, tint }] }`.
  - Recomputes on `MutationObserver` + `ResizeObserver` on the sheet,
    batched into one `requestAnimationFrame` (covers local and remote
    edits, font/image loads, resizes).
- **`DocumentOutline.tsx`** and **`DocumentMinimap.tsx`**: new
  components. Pure logic (level normalization, minimap scale and viewport
  band math, visibility rule) lives in isolated functions.
- **`usePanelPreference`**: `localStorage` preference plus the
  narrow-screen rule.
- **`CollaborativeEditor.tsx`**: only the wiring — the visibility state,
  both components, and the toggles. Comment and cursor overlays reach the
  minimap as props.

## Verification

No test infrastructure for now; all validation is manual in the browser:

- [ ] blank document
- [ ] imported HTML, paper-sheet layout
- [ ] imported HTML, full-canvas layout
- [ ] two tabs collaborating (remote cursor on the minimap, live outline
      updates)
- [ ] view-only link
- [ ] version preview
- [ ] mobile viewport (< 900px: hidden by default, overlays, preference
      untouched)

## Delivery

On branch `feature/document-outline-minimap`, kept local until decided
otherwise:

1. **Commit 1:** `useDocumentStructure`, the outline, and the visibility
   preference — verified in the browser.
2. **Commit 2:** the minimap on top of the same structure — verified in
   the browser.
