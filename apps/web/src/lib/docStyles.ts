// Utilities to preserve the uploaded document's original CSS.

export interface DocStyles {
  css: string;
  stylesheetLinks: string[];
}

// Extracts <style> and <link rel="stylesheet"> from the original head.
export function extractStyles(headHtml: string): DocStyles {
  const parsed = new DOMParser().parseFromString(
    `<html><head>${headHtml}</head><body></body></html>`,
    "text/html"
  );
  const css = Array.from(parsed.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
  const stylesheetLinks = Array.from(
    parsed.querySelectorAll('link[rel="stylesheet"]')
  )
    .map((link) => link.getAttribute("href") ?? "")
    .filter(Boolean);
  return { css, stylesheetLinks };
}

// Rewrites the document CSS so it only applies inside the editor sheet
// (html/body/:root selectors are remapped to the sheet itself).
// Rule bodies are untouched — only selector scope changes.
export function scopeCss(css: string, scope: string): string {
  let sheet: CSSStyleSheet;
  try {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
  } catch {
    // Browser without constructable stylesheets: apply unscoped
    return css;
  }

  // The editor flattens <thead>/<tbody>/<tfoot> (all rows end up in a
  // single tbody, header row first). Rewrites the document's selectors to
  // the closest equivalent in the editor structure.
  const rewriteTableSections = (selector: string): string =>
    selector
      .replace(/(?<![.#\w-])thead\s*>?\s*tr(?![\w-])/gi, "tr:first-of-type")
      .replace(/(?<![.#\w-])thead(?![\w-])/gi, "tr:first-of-type")
      .replace(/(?<![.#\w-])tfoot\s*>?\s*tr(?![\w-])/gi, "tr:last-of-type")
      .replace(/(?<![.#\w-])tfoot(?![\w-])/gi, "tr:last-of-type")
      .replace(/(?<![.#\w-])tbody\s*>\s*/gi, "")
      .replace(/(?<![.#\w-])tbody\s+/gi, "")
      .replace(/(?<![.#\w-])tbody(?![\w-])/gi, "table");

  const scopeSelector = (selector: string): string => {
    const trimmed = selector.trim();
    if (/^(html|body|:root)$/i.test(trimmed)) return scope;
    // "body > x" becomes a descendant ("x"): the sheet has internal wrappers
    const cleaned = rewriteTableSections(
      trimmed.replace(/^(html|body)\s*>?\s+/i, "").replace(/^(html|body)\s*>\s*/i, "")
    );
    return `${scope} ${cleaned}`;
  };

  const rewrite = (rules: CSSRuleList): string =>
    Array.from(rules)
      .map((rule) => {
        if (rule instanceof CSSStyleRule) {
          const selectors = rule.selectorText
            .split(",")
            .map(scopeSelector)
            .join(", ");
          return `${selectors} { ${rule.style.cssText} }`;
        }
        if (rule instanceof CSSMediaRule) {
          return `@media ${rule.conditionText} { ${rewrite(rule.cssRules)} }`;
        }
        if (rule instanceof CSSSupportsRule) {
          return `@supports ${rule.conditionText} { ${rewrite(rule.cssRules)} }`;
        }
        // @font-face, @keyframes, @import etc. stay global
        return rule.cssText;
      })
      .join("\n");

  return rewrite(sheet.cssRules);
}

// Decides whether an uploaded document reads as a PRINT-LIKE document
// (render it on the A4-ish paper sheet) or as a full-page LAYOUT
// (give it the whole canvas). Scored heuristics over the document's
// own CSS and structure — print signals vs viewport-layout signals.
export function detectPaperLayout({
  css,
  bodyHtml,
}: {
  css: string;
  bodyHtml: string;
}): boolean {
  let paper = 0;
  let layout = 0;

  // Print-oriented CSS is the strongest "document" signal
  if (/@page\b/i.test(css)) paper += 3;
  if (/@media\s+print\b/i.test(css)) paper += 2;
  // A4-ish width declarations (210mm / 21cm / ~794px)
  if (/21[05]\s*mm|21\s*cm|79[0-9]px|8\.5in/i.test(css)) paper += 2;
  // A narrow reading column (max-width up to ~1000px) suggests a document
  const maxWidths = Array.from(
    css.matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)(px|rem|em|ch)/gi)
  ).map(([, n, unit]) =>
    unit.toLowerCase() === "px" ? Number(n) : Number(n) * 16
  );
  if (maxWidths.some((w) => w >= 400 && w <= 1000)) paper += 2;

  // Viewport-designed layouts: app shells, sidebars, full-bleed pages
  if (/\b100(vh|dvh|svh)\b/i.test(css)) layout += 2;
  if (/\b100vw\b/i.test(css)) layout += 1;
  if (/position\s*:\s*(fixed|sticky)/i.test(css)) layout += 2;
  if (/grid-template-columns\s*:/i.test(css)) layout += 2;
  if (/<(aside|nav)[\s>]/i.test(bodyHtml)) layout += 2;

  return paper >= layout;
}

export function parseBodyAttrs(
  bodyAttrs: string | null | undefined
): Record<string, string> {
  if (!bodyAttrs) return {};
  try {
    const parsed = JSON.parse(bodyAttrs);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

// Same structural containment applied in the editor: images and SVGs
// never exceed the page width. The block is marked so it can be
// identified (and removed) and is not duplicated on re-export.
const FIT_STYLES =
  '<style data-html-docs="fit">svg{max-width:100%}svg[viewBox]{height:auto}img{max-width:100%;height:auto}</style>';

// Removes comment marks from the HTML: comments are collaboration
// metadata, not document content — exports must stay clean.
export function stripComments(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("[data-comment-id]").forEach((element) => {
    const parent = element.parentNode;
    if (!parent) return;
    while (element.firstChild) parent.insertBefore(element.firstChild, element);
    parent.removeChild(element);
  });
  return parsed.body.innerHTML;
}

// Recomposes the full document: original head untouched + edited body.
export function composeFullDocument({
  headHtml,
  bodyAttrs,
  bodyHtml,
  title,
}: {
  headHtml: string | null | undefined;
  bodyAttrs: string | null | undefined;
  bodyHtml: string;
  title: string;
}): string {
  let head =
    headHtml && headHtml.trim()
      ? headHtml
      : `<meta charset="utf-8"><title>${title}</title>`;
  if (!head.includes('data-html-docs="fit"')) {
    head += FIT_STYLES;
  }
  const attrs = Object.entries(parseBodyAttrs(bodyAttrs))
    .map(([name, value]) => ` ${name}="${value.replace(/"/g, "&quot;")}"`)
    .join("");
  return [
    "<!doctype html>",
    '<html>',
    `<head>${head}</head>`,
    `<body${attrs}>`,
    bodyHtml,
    "</body>",
    "</html>",
  ].join("\n");
}
