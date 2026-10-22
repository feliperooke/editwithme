// Pure helpers behind the document outline: what counts as a heading,
// how deep it indents and which one is "current" while scrolling. Kept
// free of React so the rules stay readable (and testable) on their own.

export interface OutlineHeading {
  /** HTML heading level, 1-6 */
  level: number;
  /** Indentation step, relative to the headings actually present */
  depth: number;
  text: string;
  el: HTMLElement;
}

export const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

// Collaboration cursors are widget decorations rendered INSIDE the text
// (caret + name label), so a plain textContent would read "Intro" as
// "IntroGuest 42" while someone types in that heading.
const IGNORED_TEXT_SELECTOR = ".collaboration-cursor__caret";

export function headingText(el: HTMLElement): string {
  let text = "";
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(IGNORED_TEXT_SELECTOR)) continue;
    text += node.textContent ?? "";
  }
  return text.replace(/\s+/g, " ").trim();
}

// Relative depth: the shallowest heading present is the root, and a jump
// (h2 → h4) indents a single step instead of leaving an empty one. Each
// heading nests under the closest preceding heading with a lower level.
export function headingDepths(levels: number[]): number[] {
  const stack: number[] = [];
  return levels.map((level) => {
    while (stack.length > 0 && stack[stack.length - 1] >= level) stack.pop();
    const depth = stack.length;
    stack.push(level);
    return depth;
  });
}

export function collectHeadings(root: HTMLElement): OutlineHeading[] {
  const found = Array.from(root.querySelectorAll<HTMLElement>(HEADING_SELECTOR))
    .map((el) => ({ el, level: Number(el.tagName[1]), text: headingText(el) }))
    .filter((heading) => heading.text !== "");
  const depths = headingDepths(found.map((heading) => heading.level));
  return found.map((heading, i) => ({ ...heading, depth: depths[i] }));
}

export function sameHeadings(a: OutlineHeading[], b: OutlineHeading[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (heading, i) =>
        heading.el === b[i].el &&
        heading.level === b[i].level &&
        heading.text === b[i].text
    )
  );
}

// The current section is the last heading whose top has scrolled past
// the reading line (just under the sticky chrome); null above the first.
export function activeHeadingIndex(tops: number[], readingLine: number): number | null {
  let active: number | null = null;
  tops.forEach((top, i) => {
    if (top <= readingLine) active = i;
  });
  return active;
}
