// Builds the "Export for AI" markdown: a revision-request file that an
// LLM can act on. Two modes:
//
// - "clipboard" (default): for pasting into a chat with no tool access.
//   Comment spans become lightweight <!--cN--> markers (render-
//   invisible, hard to mangle, trivial to strip) and the model is asked
//   to return the complete modified HTML.
// - "tools": for MCP clients. The body HTML is included VERBATIM (so
//   edit_document find snippets match byte-for-byte), comments are
//   listed with their real ids, and the model is told to use the
//   resolve_comment / edit_document tools instead of resending the
//   whole document — a truncated reply then cannot destroy content.

export type AiExportMode = "clipboard" | "tools";

interface AiComment {
  id: string;
  marker: string;
  author: string;
  date: string;
  text: string;
  excerpt: string;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function buildAiExport({
  title,
  bodyHtml,
  mode = "clipboard",
}: {
  title: string;
  bodyHtml: string;
  mode?: AiExportMode;
}): string {
  const parsed = new DOMParser().parseFromString(bodyHtml, "text/html");

  // Group comment fragments by id, in document order
  const fragmentsById = new Map<string, Element[]>();
  parsed.querySelectorAll("[data-comment-id]").forEach((element) => {
    const id = element.getAttribute("data-comment-id");
    if (!id) return;
    const list = fragmentsById.get(id) ?? [];
    list.push(element);
    fragmentsById.set(id, list);
  });

  const comments: AiComment[] = [];
  let index = 0;
  for (const [id, fragments] of fragmentsById) {
    index += 1;
    const marker = `c${index}`;
    const first = fragments[0];
    const last = fragments[fragments.length - 1];
    if (mode === "clipboard") {
      // Insert markers around each comment's full range (first fragment
      // to last fragment — a comment may be split across elements by
      // formatting or overlapping comments)
      first.parentNode?.insertBefore(parsed.createComment(marker), first);
      last.parentNode?.insertBefore(
        parsed.createComment(`/${marker}`),
        last.nextSibling
      );
    }
    comments.push({
      id,
      marker,
      author: first.getAttribute("data-comment-author") || "Anonymous",
      date: (first.getAttribute("data-comment-created-at") || "").slice(0, 10),
      text: first.getAttribute("data-comment-text") || "",
      excerpt: truncate(
        collapseWhitespace(fragments.map((f) => f.textContent ?? "").join("")),
        140
      ),
    });
  }

  if (mode === "clipboard") {
    // Unwrap the comment spans: markers carry the anchoring now
    parsed.querySelectorAll("[data-comment-id]").forEach((element) => {
      const parent = element.parentNode;
      if (!parent) return;
      while (element.firstChild) parent.insertBefore(element.firstChild, element);
      parent.removeChild(element);
    });
  }

  // In tools mode the original string is passed through untouched:
  // even a lossless parse/serialize round-trip could change attribute
  // order or entities and break exact-match edits.
  const html = mode === "tools" ? bodyHtml.trim() : parsed.body.innerHTML.trim();

  const commentLines =
    comments.length > 0
      ? comments
          .map((comment, i) => {
            const text = comment.text.replace(/\n/g, "\n   ");
            const ref = mode === "tools" ? `id: ${comment.id}` : comment.marker;
            return `${i + 1}. [${ref}] ${comment.author}${
              comment.date ? ` (${comment.date})` : ""
            }: "${text}"\n   > anchored text: "${comment.excerpt}"`;
          })
          .join("\n\n")
      : "_No comments — apply your own judgment to improve the document._";

  const rules =
    mode === "tools"
      ? `You are revising the BODY content of an HTML document through tools.
Apply each comment below to the document.

Rules:
- For each comment, call the \`resolve_comment\` tool with the comment's
  id and the replacement HTML for its anchored text (quoted below). The
  server replaces exactly the commented range and removes the comment.
- For any other change, call the \`edit_document\` tool with an exact
  snippet copied from the HTML below as \`find_html\` (byte-for-byte,
  matching exactly once) and the revised snippet as \`replace_html\`.
- NEVER resend or rewrite the whole document; keep every edit targeted.
- Preserve surrounding HTML exactly: tags, attributes, classes, inline
  styles, SVGs. In the commented ranges the comment mark <span>s are
  removed automatically — do not reproduce them in replacements.`
      : `You are editing the BODY content of an HTML document. Apply each comment
below to the document. Each comment is anchored in the HTML by a pair of
numbered markers: \`<!--c1-->…<!--/c1-->\` for comment 1,
\`<!--c2-->…<!--/c2-->\` for comment 2, and so on.

Rules:
- Apply every comment at its anchored range.
- After applying a comment, remove its two markers.
- Preserve all other HTML exactly as-is: tags, attributes, classes,
  inline styles, SVGs. Do not reformat or prettify untouched parts.
- Return the complete modified HTML inside a single \`\`\`html code block.`;

  return `# Revision request: ${title}

${rules}

## Comments

${commentLines}

## Document (body HTML)

\`\`\`html
${html}
\`\`\`
`;
}
