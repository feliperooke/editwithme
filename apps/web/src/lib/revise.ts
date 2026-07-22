import { JSDOM } from "jsdom";
import { getDocumentData, replaceDocumentContent } from "@/lib/data";

// Targeted revision operations for the MCP/AI path. Both apply the
// result through replaceDocumentContent (a CRDT delta), but the caller
// only ever sends the changed snippet — a truncated model reply cannot
// wipe the rest of the document: the match simply fails.
//
// jsdom, not happy-dom: happy-dom's parser swallows everything after a
// <style> inside <svg> (see aiExportServer.ts) — resolving a comment
// with it would destroy the document it parses.

const jsdomWindow = new JSDOM("").window;

export type ReviseResult = { ok: true } | { ok: false; error: string };

// Exact-match find/replace over the stored body HTML. The needle must
// match exactly once so an ambiguous or stale snippet fails loudly
// instead of editing the wrong place.
export async function editDocumentContent(
  id: string,
  findHtml: string,
  replaceHtml: string,
  key: string
): Promise<ReviseResult> {
  const doc = await getDocumentData(id);
  if (!doc || !key || key !== doc.editToken) {
    return { ok: false, error: "Document not found or invalid edit key." };
  }
  if (!findHtml) {
    return { ok: false, error: "find_html must not be empty." };
  }
  const html = doc.html;
  const at = html.indexOf(findHtml);
  if (at === -1) {
    return {
      ok: false,
      error:
        "find_html does not occur in the document. It must match the stored HTML byte-for-byte — copy the snippet from read_document or read_for_revision without reformatting.",
    };
  }
  if (html.indexOf(findHtml, at + findHtml.length) !== -1) {
    return {
      ok: false,
      error:
        "find_html occurs more than once. Include more surrounding context so the match is unique.",
    };
  }
  const next = html.slice(0, at) + replaceHtml + html.slice(at + findHtml.length);
  const applied = await replaceDocumentContent(id, next, key);
  return applied
    ? { ok: true }
    : { ok: false, error: "Failed to apply the edit." };
}

// Replaces the text range a comment is anchored to with new HTML and
// removes the comment. The server locates the range from the comment
// mark spans, so the caller never has to find (or resend) it.
export async function resolveCommentContent(
  id: string,
  commentId: string,
  replacementHtml: string,
  key: string
): Promise<ReviseResult> {
  const doc = await getDocumentData(id);
  if (!doc || !key || key !== doc.editToken) {
    return { ok: false, error: "Document not found or invalid edit key." };
  }
  const parser = new jsdomWindow.DOMParser();
  const parsed = parser.parseFromString(doc.html, "text/html");
  const fragments = Array.from(
    parsed.querySelectorAll(`[data-comment-id="${commentId}"]`)
  );
  if (fragments.length === 0) {
    return {
      ok: false,
      error:
        "No comment with that id. Use the comment id listed by read_for_revision.",
    };
  }
  // A comment may be split across several spans (formatting boundaries,
  // overlapping comments). The replacement lands where the first
  // fragment was; every fragment of the comment is removed.
  const first = fragments[0];
  const container = parsed.createElement("div");
  container.innerHTML = replacementHtml;
  const parent = first.parentNode;
  if (parent) {
    while (container.firstChild) {
      parent.insertBefore(container.firstChild, first);
    }
  }
  for (const fragment of fragments) {
    fragment.parentNode?.removeChild(fragment);
  }
  const next = parsed.body.innerHTML.trim();
  const applied = await replaceDocumentContent(id, next, key);
  return applied
    ? { ok: true }
    : { ok: false, error: "Failed to apply the edit." };
}
