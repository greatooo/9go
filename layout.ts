/** Pure layout maths for the mandala grid (no DOM, unit-testable). */

export const PAGE_SIZE = 8;

/** slot index -> [row, col]; clockwise, starting from directly above center. */
export const SLOT_POS: Array<[number, number]> = [
  [0, 1], // 1 top-center
  [0, 2], // 2 top-right
  [1, 2], // 3 middle-right
  [2, 2], // 4 bottom-right
  [2, 1], // 5 bottom-center
  [2, 0], // 6 bottom-left
  [1, 0], // 7 middle-left
  [0, 0], // 8 top-left  <- carries "more / back"
];

/** corner labels, same as the reference mock (row-major, center excluded). */
export const CELL_LABEL: Record<string, string> = {
  "0,0": "1.1",
  "0,1": "1.2",
  "0,2": "1.3",
  "1,0": "1.4",
  "1,2": "1.5",
  "2,0": "1.6",
  "2,1": "1.7",
  "2,2": "1.8",
};

export function cellLabel(row: number, col: number): string {
  return CELL_LABEL[`${row},${col}`] || "";
}

export function totalPages(childCount: number): number {
  return Math.max(1, Math.ceil(childCount / PAGE_SIZE));
}

export function clampPage(page: number, childCount: number): number {
  return Math.min(Math.max(0, page), totalPages(childCount) - 1);
}

export function pageSlice<T>(items: T[], page: number): T[] {
  const p = clampPage(page, items.length);
  return items.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);
}

/** Range text used by the "more children" link, e.g. "9-16". */
export function nextPageRange(childCount: number, page: number): [number, number] {
  const from = page * PAGE_SIZE + PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE + PAGE_SIZE, childCount);
  return [from, to];
}

/**
 * v1.3.1: range shown by the ALWAYS-visible "more children" link on the
 * last slot of every page. When real children exist inside the next batch
 * the range is capped at the real count (10 children -> "9–10"); otherwise
 * it shows the full virtual batch (3 children -> "9–16"), because the next
 * page doubles as the editing page for children 9–16.
 */
export function moreRange(childCount: number, page: number): [number, number] {
  const from = page * PAGE_SIZE + PAGE_SIZE + 1;
  const to = from + PAGE_SIZE - 1;
  if (childCount >= from && childCount <= to) return [from, childCount];
  return [from, to];
}

// ------------------------------------------------------------------ //
// v1.2.0: configurable first slot + clockwise / counter-clockwise
// ------------------------------------------------------------------ //

export type FirstSlot =
  | "top"
  | "top-right"
  | "right"
  | "bottom-right"
  | "bottom"
  | "bottom-left"
  | "left"
  | "top-left";

export type SortDirection = "cw" | "ccw";

/** Clockwise ring, starting at the cell directly above the center. */
export const RING_CW: Array<[number, number]> = [...SLOT_POS];

/** Counter-clockwise ring, same start cell, reversed traversal. */
export const RING_CCW: Array<[number, number]> = [
  RING_CW[0],
  ...RING_CW.slice(1).reverse(),
];

export const FIRST_SLOT_POS: Record<FirstSlot, [number, number]> = {
  top: [0, 1],
  "top-right": [0, 2],
  right: [1, 2],
  "bottom-right": [2, 2],
  bottom: [2, 1],
  "bottom-left": [2, 0],
  left: [1, 0],
  "top-left": [0, 0],
};

export const FIRST_SLOT_LABEL: Record<FirstSlot, string> = {
  top: "上（正上方）",
  "top-right": "右上",
  right: "右（正右方）",
  "bottom-right": "右下",
  bottom: "下（正下方）",
  "bottom-left": "左下",
  left: "左（正左方）",
  "top-left": "左上",
};

export const FIRST_SLOT_ORDER: FirstSlot[] = [
  "top",
  "top-right",
  "right",
  "bottom-right",
  "bottom",
  "bottom-left",
  "left",
  "top-left",
];

/** slot index -> [row, col]; slot 0 is the configured first-child cell. */
export function buildSlots(
  first: FirstSlot,
  dir: SortDirection
): Array<[number, number]> {
  const ring = dir === "ccw" ? RING_CCW : RING_CW;
  const anchor = FIRST_SLOT_POS[first] || FIRST_SLOT_POS.top;
  const key = (p: [number, number]) => `${p[0]},${p[1]}`;
  const at = ring.findIndex((p) => key(p) === key(anchor));
  const start = at < 0 ? 0 : at;
  return ring.slice(start).concat(ring.slice(0, start));
}

// ------------------------------------------------------------------ //
// v1.2.0: hierarchical numbering
// ------------------------------------------------------------------ //

/**
 * Compact a full dotted path for display.
 *   "1"        -> "1"
 *   "1.1"      -> "1.1"
 *   "1.1.1"    -> "1.1.1"
 *   "1.1.1.1"  -> "1...1.1"   (first segment + "..." + last two)
 * `full` must be an uncompressed path.
 */
export function compactNumber(full: string): string {
  const parts = String(full || "")
    .split(".")
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length <= 3) return parts.join(".");
  return (
    parts[0] +
    "..." +
    parts[parts.length - 2] +
    "." +
    parts[parts.length - 1]
  );
}

/** Number shown on a child cell (global 1-based sibling index). */
export function childNumber(parentPath: string, index1: number): string {
  const n = Math.max(1, Math.floor(index1 || 1));
  return compactNumber(parentPath ? `${parentPath}.${n}` : String(n));
}

/** Move an item inside an index list; returns the new list of ORIGINAL indices. */
export function moveIndices(length: number, from: number, finalAt: number): number[] {
  const idx = Array.from({ length }, (_v, i) => i);
  if (from < 0 || from >= length) return idx;
  const [item] = idx.splice(from, 1);
  const at = Math.min(length - 1, Math.max(0, finalAt));
  idx.splice(at, 0, item);
  return idx;
}

/** Convert a drag (from, target, after) into the final insertion index. */
export function dropFinalAt(from: number, target: number, after: boolean): number {
  const insertAt = target + (after ? 1 : 0);
  return from < insertAt ? insertAt - 1 : insertAt;
}
