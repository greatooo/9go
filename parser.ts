/**
 * 9go / parser.ts
 * ------------------------------------------------------------------
 * Parse a plain Markdown note into a tree that is compatible with the
 * gogoga-mindmap outline convention:
 *
 *   # / ## / ### ...   -> heading nodes (nested by level, no level skip issues)
 *   - / * / + / 1.     -> list nodes (nested by indent: Tab = 1, 2 spaces = 1)
 *   paragraph right
 *   after a node         -> that node's "note" (multiple lines allowed)
 *   > [!note] callout   -> note content, stripped of the "> " prefix
 *   %%...%%             -> gogoga marker, ignored
 *   ``` fenced block    -> skipped entirely
 *
 * Root node (level 0) always represents the note title, so:
 *   root.children  == the "# 一级" headings (+ top level list items)
 *   H1.children    == the "## 二级" headings
 * which is exactly the mandala drill-down model.
 */

export interface OutlineNode {
  id: string;
  title: string;
  raw: string;
  level: number;
  line: number;
  notes: string[];
  children: OutlineNode[];
  parent: OutlineNode | null;
}

export interface Outline {
  root: OutlineNode;
  fileTitle: string;
  headingCount: number;
  listCount: number;
}

export interface ParseOptions {
  fileTitle: string;
  rootSource?: "filename" | "firstH1";
}

let seq = 0;
function newId(): string {
  seq += 1;
  return "n" + seq;
}

/** Remove gogoga markers, block ids, wiki/markdown link syntax for display. */
export function cleanTitle(input: string): string {
  let s = String(input ?? "");
  s = s.replace(/%%[\s\S]*?%%/g, "");
  s = s.replace(/\s+\^[A-Za-z0-9_-]+\s*$/g, "");
  // [[target#heading|alias]] / [[target|alias]] -> alias
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_m, _target, alias) => alias);
  // [[target#heading]] / [[path/target]] -> last readable segment
  s = s.replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
    const parts = inner.split("|")[0].split("#");
    const name = parts[0] || parts[1] || "";
    return (name.split("/").pop() || name).trim();
  });
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1");
  s = s.replace(/`([^`]+)`/g, "$1");
  return s.replace(/\s+/g, " ").trim();
}

/** Strip callout prefixes and inline markers from a note line. */
export function cleanNote(input: string): string {
  let s = String(input ?? "");
  s = s.replace(/^\s*>\s?/, "");
  if (/^\s*\[!note\]/i.test(s)) return "";
  s = s.replace(/%%[\s\S]*?%%/g, "");
  s = s.replace(/\s+\^[A-Za-z0-9_-]+\s*$/g, "");
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_m, _t, a) => a);
  s = s.replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
    const parts = inner.split("|")[0].split("#");
    const name = parts[0] || parts[1] || "";
    return name.split("/").pop() || name;
  });
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Tab-indented continuation lines are gogoga notes; drop the leading
  // whitespace so the preview is clean and comparable.
  return s.trim();
}

/** Leading whitespace -> logical indent units (Tab = 1, 2 spaces = 1). */
function indentOf(line: string): number {
  const m = /^([ \t]*)/.exec(line);
  if (!m) return 0;
  const ws = m[1];
  const tabs = (ws.match(/\t/g) || []).length;
  const spaces = (ws.match(/ /g) || []).length;
  return tabs + Math.floor(spaces / 2);
}

function makeNode(
  raw: string,
  level: number,
  line: number,
  parent: OutlineNode | null,
  titleOverride?: string
): OutlineNode {
  const node: OutlineNode = {
    id: newId(),
    title: titleOverride !== undefined ? titleOverride : cleanTitle(raw),
    raw,
    level,
    line,
    notes: [],
    children: [],
    parent,
  };
  // Keep the back-reference but hide it from enumeration so the whole
  // outline stays JSON-serialisable (no circular structure).
  Object.defineProperty(node, "parent", {
    value: parent,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  if (parent) parent.children.push(node);
  return node;
}

/** Strip YAML frontmatter, return [body, lineOffset]. */
function stripFrontmatter(text: string): [string, number] {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== "---") return [text, 0];
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---" || lines[i].trim() === "...") {
      return [lines.slice(i + 1).join("\n"), i + 1];
    }
  }
  return [text, 0];
}

export function parseOutline(text: string, options: ParseOptions): Outline {
  seq = 0;
  const [body, offset] = stripFrontmatter(text);
  const lines = body.split(/\r?\n/);

  const fileTitle = options.fileTitle || "Untitled";
  const root = makeNode(fileTitle, 0, 0, null, fileTitle);
  let headingCount = 0;
  let listCount = 0;

  // headingStack[i] = last node at heading level i+1
  const headingStack: OutlineNode[] = [];
  const listStack: { indent: number; node: OutlineNode }[] = [];
  let lastNode: OutlineNode = root;
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNo = i + offset;

    // --- fenced code block: skip completely (dataviewjs, mindmap, etc.) ---
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const mark = fenceMatch[1][0];
      if (fence === null) fence = mark;
      else if (fence === mark) fence = null;
      continue;
    }
    if (fence !== null) continue;

    if (line.trim() === "") continue;

    // --- standalone gogoga marker line ---
    if (/^\s*%%[\s\S]*%%\s*$/.test(line)) continue;

    // --- heading ---
    const hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm) {
      const level = hm[1].length;
      const title = cleanTitle(hm[2]);
      // nearest ancestor with a strictly smaller heading level
      let parent: OutlineNode = root;
      for (let l = level - 1; l >= 1; l -= 1) {
        if (headingStack[l - 1]) {
          parent = headingStack[l - 1];
          break;
        }
      }
      const node = makeNode(hm[2], level, lineNo, parent, title);
      headingStack.length = level - 1;
      headingStack[level - 1] = node;
      listStack.length = 0;
      lastNode = node;
      headingCount += 1;
      continue;
    }

    // --- list item ---
    const lm = /^([ \t]*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (lm) {
      const indent = indentOf(line);
      const title = cleanTitle(lm[2]);
      let parent: OutlineNode = root;
      for (let k = listStack.length - 1; k >= 0; k -= 1) {
        if (listStack[k].indent < indent) {
          parent = listStack[k].node;
          break;
        }
      }
      if (parent === root) {
        for (let l = headingStack.length - 1; l >= 0; l -= 1) {
          if (headingStack[l]) {
            parent = headingStack[l];
            break;
          }
        }
      }
      const node = makeNode(lm[2], Math.max(parent.level + 1, 7), lineNo, parent, title);
      while (listStack.length && listStack[listStack.length - 1].indent >= indent) {
        listStack.pop();
      }
      listStack.push({ indent, node });
      lastNode = node;
      listCount += 1;
      continue;
    }

    // --- note line ---
    // gogoga convention: a paragraph following a node belongs to that node.
    // Blank lines and fenced code blocks do NOT break the attachment, because
    // real notes often put a marker / blank line between heading and note.
    const note = cleanNote(line);
    if (note.trim() !== "") lastNode.notes.push(note);
  }

  // Optional: display the first H1 as the center label instead of the filename.
  // Tree shape is intentionally unchanged, so no sibling is ever lost.
  if (options.rootSource === "firstH1") {
    const firstH1 = root.children.find((c) => c.level === 1);
    if (firstH1) root.title = firstH1.title;
  }

  return { root, fileTitle, headingCount, listCount };
}

/** Collapse a chain of single-child roots (useful for notes with only one H1). */
export function collapseSingleRoot(root: OutlineNode): OutlineNode[] {
  const chain: OutlineNode[] = [root];
  let cur = root;
  let guard = 0;
  while (
    cur.children.length === 1 &&
    cur.children[0].children.length > 0 &&
    guard < 8
  ) {
    cur = cur.children[0];
    chain.push(cur);
    guard += 1;
  }
  return chain;
}

/** Plain-text preview of a node's notes, truncated to maxChars. */
export function notePreview(node: OutlineNode, maxChars: number): string {
  if (!node.notes.length) return "";
  const joined = node.notes.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (maxChars <= 0 || joined.length <= maxChars) return joined;
  return joined.slice(0, maxChars).trimEnd() + "…";
}

/** Count descendants (immediate children only by default). */
export function childCount(node: OutlineNode): number {
  return node.children.length;
}

/** Find a node by its absolute source line (root has line 0). */
export function findNodeByLine(root: OutlineNode, line: number): OutlineNode | null {
  if (root.line === line) return root;
  for (const c of root.children) {
    const hit = findNodeByLine(c, line);
    if (hit) return hit;
  }
  return null;
}

/**
 * Deepest node whose heading / list line is at or before `line`.
 * A caret sitting in a note, a blank line or a frontmatter line therefore
 * resolves to the nearest preceding outline node (root as the fallback).
 * Used by the "follow cursor" feature to choose the mandala centre.
 */
export function findNodeAtLine(root: OutlineNode, line: number): OutlineNode {
  const at = Math.max(0, Math.floor(Number(line) || 0));
  let best: OutlineNode = root;
  const walk = (n: OutlineNode): void => {
    if (n.line <= at && n.line >= best.line) best = n;
    for (const c of n.children) {
      if (c.line <= at) walk(c);
    }
  };
  walk(root);
  return best;
}

/** Ancestor chain root -> node (uses the non-enumerable parent link). */
export function nodePath(node: OutlineNode): OutlineNode[] {
  const out: OutlineNode[] = [];
  let cur: OutlineNode | null = node;
  let guard = 0;
  while (cur && guard < 64) {
    out.unshift(cur);
    cur = cur.parent;
    guard += 1;
  }
  return out;
}

// ------------------------------------------------------------------ //
// Inserting a new child node (double-click an empty mandala cell)
// ------------------------------------------------------------------ //

export type NewNodeNoteStyle = "callout" | "paragraph";

export interface NewNodeSpec {
  title: string;
  notes: string[];
}

/**
 * Logical level of a raw markdown line:
 *   heading  -> 1..6
 *   list item-> 7 + indent units (Tab = 1, 2 spaces = 1)
 *   other    -> null
 * This mirrors parseOutline so heading levels and list levels are comparable.
 */
export function lineLevel(line: string): number | null {
  const h = /^\s*(#{1,6})\s/.exec(line);
  if (h) return h[1].length;
  const l = /^([ \t]*)(?:[-*+]|\d+[.)])\s/.exec(line);
  if (l) {
    const ws = l[1];
    const tabs = (ws.match(/\t/g) || []).length;
    const spaces = (ws.match(/ /g) || []).length;
    return 7 + tabs + Math.floor(spaces / 2);
  }
  return null;
}

/** Leading whitespace + bullet of a list line (for cloning the indent). */
function listPrefixOf(line: string): { indent: string; bullet: string } | null {
  const m = /^([ \t]*)([-*+]|\d+[.)])\s/.exec(line);
  if (!m) return null;
  return { indent: m[1], bullet: m[2] };
}

/**
 * Marker for a new child of `center`:
 *   - headings keep the same "#" count as the existing children
 *   - list children clone the first child's indentation and bullet
 *   - when there are no children yet, derive the level from the center
 */
export function childMarker(text: string, center: OutlineNode): string {
  const lines = text.split(/\r?\n/);
  const kids = center.children;
  const minLevel = kids.length
    ? Math.min.apply(null, kids.map((c) => c.level))
    : -1;

  if (kids.length && minLevel >= 7) {
    const src = listPrefixOf(lines[kids[0].line] || "");
    return src ? src.indent + src.bullet + " " : "- ";
  }

  if (kids.length) {
    return "#".repeat(Math.min(6, Math.max(1, minLevel))) + " ";
  }
  if (center.level === 0) return "# ";
  if (center.level >= 1 && center.level <= 5) {
    return "#".repeat(center.level + 1) + " ";
  }
  // Center is an H6 or a list item with no children yet: make a list item
  // one level deeper than the center line so it stays under the center.
  const lp = listPrefixOf(lines[center.line] || "");
  return (lp ? lp.indent + "\t" : "") + "- ";
}

/**
 * Return the full note text with a new child node appended at the end of
 * `center`'s section. The insertion point is the first line AFTER the center
 * whose level is <= the center's level (i.e. the next sibling or ancestor),
 * falling back to EOF. Fenced code blocks are skipped while scanning.
 *
 * Notes are written as `> ` callout lines by default (parser turns them into
 * node notes); `paragraph` writes plain lines and guards lines that would
 * otherwise be parsed as headings / lists / fences.
 */
/**
 * Turn modal note lines into Markdown note lines.
 * `callout` uses `> ` (safest: never parsed as a heading / list).
 * `paragraph` guards lines that would otherwise become structure.
 *
 * `indent` is the NOTE indent, which for list nodes is one level deeper than
 * the node itself. A flush-left `> ` right after a list item terminates that
 * list in CommonMark, so following Tab-indented `- ` children degrade into a
 * literal "- " (no bullet) in Obsidian reading view. Heading nodes keep their
 * notes flush-left because no list context can be broken there.
 */
function noteLines(
  notes: string[],
  style: NewNodeNoteStyle,
  indent: string
): string[] {
  const out: string[] = [];
  for (const raw of notes || []) {
    let n = String(raw ?? "").trim();
    if (!n) continue;
    // "[!note]" is treated as a callout header by cleanNote; keep it as text.
    if (/^\[!/.test(n)) n = "\u200b" + n;
    if (style === "callout") {
      out.push(indent + "> " + n);
    } else {
      const risky = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|`{3,}|~{3,}|%%)/.test(n);
      out.push(indent + (risky ? "\u200b" + n : n));
    }
  }
  return out;
}

/** Inline markers that must survive a title rewrite (`%%tag%%`, `^blockid`). */
function trailingMarkers(raw: string): string {
  const s = String(raw ?? "");
  const marks: string[] = [];
  const mm = s.match(/%%[\s\S]*?%%/g);
  if (mm && mm.length) marks.push(...mm);
  const id = /\s+(\^[A-Za-z0-9_-]+)\s*$/.exec(s);
  if (id) marks.push(id[1]);
  return marks.length ? " " + marks.join(" ") : "";
}

export function insertChildNode(
  text: string,
  center: OutlineNode,
  spec: NewNodeSpec,
  noteStyle: NewNodeNoteStyle = "callout"
): string {
  const title = String(spec.title ?? "").trim();
  if (!title) return text;

  const nl = text.indexOf("\r\n") >= 0 ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const marker = childMarker(text, center);
  const listMatch = /^([ \t]*)(?:[-*+]|\d+[.)])\s/.exec(marker);
  const nodeIndent = listMatch ? listMatch[1] : "";
  // List-node notes live one level deeper; see noteLines() for the reason.
  const noteIndent = listMatch ? nodeIndent + "\t" : nodeIndent;

  // Locate the end of the center's section.
  const endLine = sectionEndLine(lines, center.line, center.level);

  const block: string[] = [
    marker + title,
    ...noteLines(spec.notes, noteStyle, noteIndent),
  ];

  const before = lines.slice(0, endLine);
  const after = lines.slice(endLine);
  const insert: string[] = [];
  if (before.length && before[before.length - 1].trim() !== "") insert.push("");
  insert.push(...block);
  if (after.length && after[0].trim() !== "") insert.push("");

  return before.concat(insert, after).join(nl);
}

/**
 * Exclusive end line of a section that starts at `startLine` with `level`.
 * The first later line whose level is <= `level` closes the section.
 * Fenced code blocks are skipped so ```# fake heading``` cannot truncate it.
 */
export function sectionEndLine(
  lines: string[],
  startLine: number,
  level: number
): number {
  let fence: string | null = null;
  for (let i = startLine + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const fm = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fm) {
      const mk = fm[1][0];
      if (fence === null) fence = mk;
      else if (fence === mk) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const lvl = lineLevel(line);
    if (lvl !== null && lvl <= level) return i;
  }
  return lines.length;
}

/**
 * Reorder the direct children of `center` in the raw Markdown.
 * `order` is a permutation of 0..n-1 listing ORIGINAL child indices in the
 * desired new order. Each child block spans [child.line, nextChild.line) —
 * i.e. its whole subtree plus any notes / blank lines before the next
 * sibling — so dragging a heading keeps its descendants attached.
 */
export function reorderChildren(
  text: string,
  center: OutlineNode,
  order: number[]
): string {
  const kids = center.children;
  if (kids.length < 2) return text;
  const valid =
    Array.isArray(order) &&
    order.length === kids.length &&
    order.every((i) => Number.isInteger(i) && i >= 0 && i < kids.length) &&
    new Set(order).size === kids.length;
  if (!valid) return text;
  if (order.every((v, i) => v === i)) return text;

  const nl = text.indexOf("\r\n") >= 0 ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const centerEnd = sectionEndLine(lines, center.line, center.level);

  const ranges = kids.map((k, i) => ({
    start: k.line,
    end: i + 1 < kids.length ? kids[i + 1].line : centerEnd,
  }));
  // Defensive: never let a malformed outline produce overlapping ranges.
  for (let i = 0; i < ranges.length; i += 1) {
    if (ranges[i].end < ranges[i].start) return text;
  }

  const head = lines.slice(0, kids[0].line);
  const tail = lines.slice(centerEnd);
  const blocks = ranges.map((r) => lines.slice(r.start, r.end));
  const merged: string[] = [];
  for (const i of order) merged.push(...blocks[i]);

  return head.concat(merged, tail).join(nl);
}

// ------------------------------------------------------------------ //
// v1.3.1: promote a child by dropping it onto the centre cell
// ------------------------------------------------------------------ //

/**
 * Promote the `index`-th direct child of `center` one level up: it is moved
 * out of the centre's section and re-inserted immediately AFTER the centre's
 * whole section, so it becomes the centre's next sibling (same parent).
 *
 * The node's own marker is rewritten to the centre's marker (heading level /
 * list indent), otherwise a shallower heading would still parse as a child.
 * The node's notes and its whole subtree travel with it untouched.
 * Returns the original text when the move is impossible.
 */
export function promoteChildNode(
  text: string,
  center: OutlineNode,
  index: number
): string {
  const kids = center.children;
  if (!center || !center.parent) return text; // root: nothing to promote to
  if (!Number.isInteger(index) || index < 0 || index >= kids.length) return text;

  const nl = text.indexOf("\r\n") >= 0 ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const node = kids[index];
  const centerEnd = sectionEndLine(lines, center.line, center.level);
  const nodeStart = node.line;
  const nodeEnd = index + 1 < kids.length ? kids[index + 1].line : centerEnd;
  if (
    nodeStart <= center.line ||
    nodeEnd > centerEnd ||
    nodeEnd <= nodeStart ||
    nodeStart >= lines.length
  ) {
    return text;
  }

  // The promoted node must inherit the centre's marker (level + style).
  const centerHead = /^(\s*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+))([\s\S]*)$/.exec(
    lines[center.line]
  );
  const nodeHead = /^(\s*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+))([\s\S]*)$/.exec(
    lines[nodeStart]
  );
  if (!centerHead || !nodeHead) return text;

  // Centre section minus the moved node, then the node re-inserted after it.
  const kept = lines
    .slice(0, nodeStart)
    .concat(lines.slice(nodeEnd, centerEnd));
  const nodeBlock = [centerHead[1] + nodeHead[2]].concat(
    lines.slice(nodeStart + 1, nodeEnd)
  );
  const tail = lines.slice(centerEnd);
  while (nodeBlock.length && nodeBlock[nodeBlock.length - 1].trim() === "") {
    nodeBlock.pop();
  }
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  const sep1 = kept.length ? [""] : [];
  const sep2 = tail.length && tail[0].trim() !== "" ? [""] : [];

  return kept.concat(sep1, nodeBlock, sep2, tail).join(nl);
}

// ------------------------------------------------------------------ //
// v1.3.0: editing an existing node (title + notes)
// ------------------------------------------------------------------ //

/**
 * Replace the title and/or the notes of ONE existing node in the raw Markdown.
 *
 * - The heading / list marker and any inline `%%tag%%` / `^blockid` suffixes
 *   are preserved. If the title was not changed, the whole line is left
 *   byte-for-byte untouched (so wikilinks / bold / inline code survive).
 * - Only the node's OWN note lines (between its line and its first child,
 *   or the end of its section) are rewritten. Fenced code blocks, structural
 *   lines, marker lines and blank lines are never touched.
 * - Children, siblings, frontmatter and CRLF line endings stay intact.
 */
export function updateNode(
  text: string,
  node: OutlineNode,
  spec: NewNodeSpec,
  noteStyle: NewNodeNoteStyle = "callout"
): string {
  const title = String(spec.title ?? "").trim();
  if (!title) return text;
  if (!node || !node.parent) return text; // root (file title) has no source line

  const nl = text.indexOf("\r\n") >= 0 ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const i = node.line;
  if (i < 0 || i >= lines.length) return text;

  const head = /^(\s*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+))([\s\S]*)$/.exec(lines[i]);
  if (!head) return text;
  const marker = head[1];
  const oldRaw = head[2];
  // Guard against a stale outline object (the file changed while the modal
  // was open) so we can never rewrite the wrong line.
  if (cleanTitle(oldRaw) !== cleanTitle(node.raw)) return text;

  const nodeIndent = /^([ \t]*)/.exec(marker)?.[1] ?? "";
  const isListNode = /^\s*(?:[-*+]|\d+[.)])\s/.test(lines[i]);
  // List-node notes live one level deeper; see noteLines() for the reason.
  const noteIndent = isListNode ? nodeIndent + "\t" : nodeIndent;
  const titleChanged = cleanTitle(oldRaw) !== title;

  // Own-notes window: after the node line, before its first child / section end.
  const secEnd = sectionEndLine(lines, i, node.level);
  const firstChild = node.children.length ? node.children[0].line : lines.length;
  let end = Math.min(secEnd, firstChild);
  if (end <= i) end = i + 1;

  const oldNoteIdx: number[] = [];
  let fence: string | null = null;
  for (let k = i + 1; k < end; k += 1) {
    const ln = lines[k];
    const fm = /^\s*(`{3,}|~{3,})/.exec(ln);
    if (fm) {
      const mk = fm[1][0];
      if (fence === null) fence = mk;
      else if (fence === mk) fence = null;
      continue;
    }
    if (fence !== null) continue;
    if (ln.trim() === "") continue;
    if (/^\s*%%[\s\S]*%%\s*$/.test(ln)) continue;
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(ln)) continue; // horizontal rule
    if (lineLevel(ln) !== null) continue; // a heading / list line is structure
    oldNoteIdx.push(k);
  }

  const insertAt = oldNoteIdx.length ? oldNoteIdx[0] : i + 1;
  const block = noteLines(spec.notes, noteStyle, noteIndent);
  // Remove from the back so the earlier indices stay valid.
  for (let k = oldNoteIdx.length - 1; k >= 0; k -= 1) {
    lines.splice(oldNoteIdx[k], 1);
  }
  if (block.length) lines.splice(insertAt, 0, ...block);
  if (titleChanged) lines[i] = marker + title + trailingMarkers(oldRaw);

  return lines.join(nl);
}
