/**
 * 9go  —  Mandala (3x3) view for Obsidian
 * ------------------------------------------------------------------
 * A standalone plugin built on the gogoga-mindmap outline convention.
 * Nothing is hard-coded with the gogoga plugin id, so both plugins can
 * be enabled at the same time.
 *
 * Trigger keywords ("mandala" by default):
 *   - frontmatter:  mandala: true   /   mindmap-structure: mandala
 *   - inline marker: %%mandala%%
 *   - fenced block:  ```mandala ... ```  (embedded grid)
 *   - command palette / file context menu
 *
 * Layout (clockwise, starting from the cell directly ABOVE the center):
 *        [8] [1] [2]
 *        [7] [C] [3]
 *        [6] [5] [4]
 * Cell labels in the corners follow the reference mock: 1.1 ... 1.8
 */

import {
  App,
  ItemView,
  MarkdownView,
  Menu,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import {
  collapseSingleRoot,
  extractNoteImages,
  findNodeAtLine,
  findNodeByLine,
  insertChildNode,
  nodePath,
  nodeEditNotes,
  notePreview,
  notePreviewRaw,
  parseOutline,
  promoteChildNode,
  reorderChildren,
  updateNode,
  type NewNodeSpec,
  type NewNodeNoteStyle,
  type NoteImage,
  type Outline,
  type OutlineNode,
} from "./parser";
import { tr, setLanguage, slotLabel, type Lang } from "./i18n";
import {
  buildSlots,
  cellLabel,
  childNumber,
  clampPage,
  compactNumber,
  dropFinalAt,
  FIRST_SLOT_ORDER,
  moreRange,
  moveIndices,
  PAGE_SIZE,
  SLOT_POS,
  totalPages,
  type FirstSlot,
  type SortDirection,
} from "./layout";

const VIEW_TYPE = "9go-mandala-view";
const ICON = "grid";
/** 参考实现（语法来源）仓库地址，设置面板「参考与致谢」里打开。 */
const REFERENCE_REPO_URL = "https://github.com/JackWeiGogoga/gogoga-mindmap";

interface NineGoSettings {
  autoOpen: boolean;
  keywords: string;
  showNotes: boolean;
  noteMaxChars: number;
  /** v1.3.2: render image thumbnails found in a node's title / notes. */
  showThumbnails: boolean;
  /** v1.3.2: max thumbnail height in px (clamped 32..320 by the renderer). */
  thumbMaxHeight: number;
  rootSource: "filename" | "firstH1";
  autoCollapseSingleRoot: boolean;
  embedHeight: number;
  singleClickLocate: boolean;
  highlightDuration: number;
  locateFallback: "none" | "split" | "tab";
  newNodeNoteStyle: NewNodeNoteStyle;
  firstSlot: FirstSlot;
  sortDirection: SortDirection;
  showSlotCoords: boolean;
  enableDragReorder: boolean;
  /** v1.3.2: UI language. "zh" keeps the original Chinese strings. */
  language: Lang;
  followCursor: boolean;
  followCursorMode: "self" | "parent";
}

const DEFAULT_SETTINGS: NineGoSettings = {
  autoOpen: true,
  keywords: "mandala",
  showNotes: false,
  noteMaxChars: 120,
  showThumbnails: true,
  thumbMaxHeight: 96,
  rootSource: "filename",
  autoCollapseSingleRoot: false,
  embedHeight: 460,
  singleClickLocate: true,
  highlightDuration: 1400,
  locateFallback: "split",
  newNodeNoteStyle: "callout",
  firstSlot: "top",
  sortDirection: "cw",
  showSlotCoords: false,
  enableDragReorder: true,
  language: "zh",
  followCursor: false,
  followCursorMode: "parent",
};

// ------------------------------------------------------------------ //
// Locate highlight lifetime
// ------------------------------------------------------------------ //

const FLASH_GUARD_MS = 50;
const FLASH_FADE_MS = 220;
const FLASH_CLASS = "enm-locate-flash";
const FLASH_FADE_CLASS = "enm-locate-flash-fade";

/**
 * Owns the lifetime of the "locate" highlight in the Markdown pane.
 *
 * A plain `class + CSS animation` is unreliable here: CodeMirror 6 rebuilds
 * `.cm-line` nodes when the viewport scrolls, the caret moves or a
 * decoration changes. The highlight then dies with that one concrete DOM
 * node at an unpredictable moment - the "flashes and is gone / duration is
 * unstable even though the setting says 1400ms" symptom.
 *
 * Instead a single JS deadline owns the configured duration, a steady CSS
 * rule paints the highlight, and a light guard re-applies the class to the
 * (possibly rebuilt) line until the deadline. No `@codemirror/*` import:
 * we simply re-run the same DOM lookup the initial flash uses.
 */
class LocateFlash {
  private deadlineTimer: number | null = null;
  private guardTimer: number | null = null;
  private fadeTimer: number | null = null;
  private deadline = 0;
  private duration = 0;
  private fading = false;
  private current: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private find: (() => HTMLElement | null) | null = null;

  /** Stop the current highlight completely. Safe to call repeatedly. */
  clear(): void {
    this.stopTimers();
    if (this.current) this.current.classList.remove(FLASH_CLASS, FLASH_FADE_CLASS);
    this.current = null;
    this.root = null;
    this.find = null;
    this.deadline = 0;
    this.fading = false;
  }

  /** Start (or restart) a highlight that stays lit for exactly `duration` ms. */
  start(
    root: HTMLElement,
    target: HTMLElement,
    find: () => HTMLElement | null,
    duration: number
  ): void {
    this.clear();
    this.root = root;
    this.find = find;
    const safe = Number.isFinite(duration) && duration > 0 ? duration : 1400;
    this.duration = Math.min(10000, Math.max(300, safe));
    this.deadline = Date.now() + this.duration;
    this.apply(target);
    this.deadlineTimer = window.setTimeout(() => this.finish(), this.duration);
    this.scheduleGuard();
  }

  private apply(el: HTMLElement): void {
    if (this.current && this.current !== el) {
      this.current.classList.remove(FLASH_CLASS, FLASH_FADE_CLASS);
    }
    el.classList.remove(FLASH_FADE_CLASS);
    el.classList.add(FLASH_CLASS);
    this.current = el;
  }

  private scheduleGuard(): void {
    this.guardTimer = window.setTimeout(() => {
      this.guardTimer = null;
      this.guard();
      if (!this.fading && this.deadline > 0) this.scheduleGuard();
    }, FLASH_GUARD_MS);
  }

  /** Re-attach the class if CodeMirror replaced the highlighted line. */
  private guard(): void {
    if (this.fading) return;
    if (this.root && this.root.isConnected === false) {
      this.clear();
      return;
    }
    if (Date.now() >= this.deadline) {
      this.finish();
      return;
    }
    const cur = this.current;
    if (cur && cur.isConnected !== false && cur.classList.contains(FLASH_CLASS)) return;
    if (!this.find) return;
    let el: HTMLElement | null = null;
    try {
      el = this.find();
    } catch (_e) {
      return;
    }
    if (el) this.apply(el);
  }

  private finish(): void {
    if (this.fading) return;
    this.stopTimers();
    this.fading = true;
    if (!this.current) {
      this.clear();
      return;
    }
    this.current.classList.add(FLASH_FADE_CLASS);
    const el = this.current;
    this.fadeTimer = window.setTimeout(() => {
      this.fadeTimer = null;
      el.classList.remove(FLASH_CLASS, FLASH_FADE_CLASS);
      this.clear();
    }, FLASH_FADE_MS);
  }

  private stopTimers(): void {
    const timers = [this.deadlineTimer, this.guardTimer, this.fadeTimer];
    for (const t of timers) if (t !== null) window.clearTimeout(t);
    this.deadlineTimer = null;
    this.guardTimer = null;
    this.fadeTimer = null;
  }
}

// ------------------------------------------------------------------ //
// v1.3.2 · image URL resolution (vault access lives here, not in the grid)
// ------------------------------------------------------------------ //

/** Cap thumbnails per cell so one image-heavy node cannot swallow the grid. */
const MAX_THUMBS_PER_CELL = 3;

/** Resolve a NoteImage to something an <img src> accepts. */
function imageSrc(app: App, ref: NoteImage, sourcePath: string): string | null {
  if (ref.kind === "external") return ref.src;
  if (ref.kind !== "file") return null;
  const f = app.metadataCache.getFirstLinkpathDest(ref.src, sourcePath);
  if (!(f instanceof TFile)) return null;
  const vault = app.vault as unknown as { getResourcePath?: (file: TFile) => string };
  if (typeof vault.getResourcePath === "function") return vault.getResourcePath(f);
  const adapter = app.vault.adapter as unknown as {
    getResourcePath?: (path: string) => string;
  };
  return typeof adapter.getResourcePath === "function"
    ? adapter.getResourcePath(f.path)
    : null;
}

/**
 * `[[note#^blockid]]` -> read the target note -> find the block line ->
 * take the first image inside it. Kept one level deep (no recursive blocks).
 */
async function blockImageSrc(
  app: App,
  ref: NoteImage,
  sourcePath: string
): Promise<string | null> {
  if (!ref.blockId) return null;
  const f = app.metadataCache.getFirstLinkpathDest(ref.src || "", sourcePath);
  if (!(f instanceof TFile)) return null;
  const text = await app.vault.cachedRead(f);
  const id = ref.blockId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tail = new RegExp("\\^" + id + "\\s*$");
  const line = text.split(/\r?\n/).find((l) => tail.test(l.trimEnd()));
  if (!line) return null;
  for (const im of extractNoteImages(line)) {
    if (im.kind === "block") continue;
    const src = imageSrc(app, im, f.path);
    if (src) return src;
  }
  return null;
}

// ------------------------------------------------------------------ //
// Grid renderer (shared by the ItemView and the ```mandala code block)
// ------------------------------------------------------------------ //

/** A resolved thumbnail, handed to the caller lightbox by GridOptions. */
export interface PreviewImage {
  src: string;
  label: string;
}

/** Pure helper: wrap around a preview list. Exported for Node regressions. */
function previewIndex(current: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return ((current + delta) % total + total) % total;
}

interface GridOptions {
  showNotes: boolean;
  noteMaxChars: number;
  /** v1.3.2 opt-in: left undefined by the older DOM harnesses. */
  showThumbnails?: boolean;
  thumbMaxHeight?: number;
  resolveImageSrc?: (img: NoteImage) => string | null;
  resolveBlockImage?: (img: NoteImage) => Promise<string | null>;
  /** v1.3.2 patch: click a thumbnail -> full-size preview (optional for harnesses). */
  onPreviewImage?: (images: PreviewImage[], index: number) => void;
  autoCollapseSingleRoot: boolean;
  singleClickLocate?: boolean;
  slots?: Array<[number, number]>;
  showSlotCoords?: boolean;
  enableDragReorder?: boolean;
  onLocate?: (node: OutlineNode, forceOpen?: boolean) => void;
  onAddNode?: (slot: number) => void;
  onEditNode?: (node: OutlineNode) => void;
  onReorder?: (from: number, target: number, after: boolean) => void;
  /** v1.3.1: drop a child onto the centre cell -> promote it one level up. */
  onPromoteNode?: (from: number) => void;
  onOpenMarkdown?: () => void;
}

class MandalaGrid {
  private host: HTMLElement;
  private outline: Outline;
  private opts: GridOptions;
  private stack: OutlineNode[];
  private slots: Array<[number, number]>;
  private page = 0;
  /**
   * v1.3.2 patch: tri-state note visibility for surrounding cells.
   * A missing key follows the global "show notes" setting; true/false is an
   * explicit user override. The old Set could only force notes OPEN, so with
   * the setting ON the toggle appeared to do nothing.
   */
  private noteOpen = new Map<string, boolean>();
  /**
   * v1.3.1: `null` = follow the global "show notes" setting (so the centre
   * cell displays its notes by default when that setting is on); otherwise
   * the user's explicit toggle on the centre cell overrides it.
   */
  private centerOpen: boolean | null = null;
  private pendingLocate: number | null = null;
  private dragFrom: number | null = null;
  private dropMark: { cell: HTMLElement; after: boolean } | null = null;
  private focusLine = -1;
  private focusNodeLine = -1;

  constructor(host: HTMLElement, outline: Outline, opts: GridOptions) {
    this.host = host;
    this.outline = outline;
    this.opts = opts;
    this.slots =
      opts.slots && opts.slots.length === PAGE_SIZE ? opts.slots : SLOT_POS;
    this.stack = opts.autoCollapseSingleRoot
      ? collapseSingleRoot(outline.root)
      : [outline.root];
  }

  get center(): OutlineNode {
    return this.stack[this.stack.length - 1];
  }

  get totalPages(): number {
    return totalPages(this.center.children.length);
  }

  /** Navigation snapshot, used to survive vault "modify" re-renders. */
  getStackTitles(): string[] {
    return this.stack.map((n) => n.title);
  }

  /** Same path as absolute source lines; survives a TITLE rename on re-render. */
  getStackLines(): number[] {
    return this.stack.map((n) => n.line);
  }

  getPage(): number {
    return this.page;
  }

  /** Snapshot of per-cell note overrides so they survive a grid rebuild. */
  getNoteOverrides(): Array<[string, boolean]> {
    return Array.from(this.noteOpen.entries());
  }

  applyNoteOverrides(entries: Array<[string, boolean]>): void {
    this.noteOpen = new Map(entries || []);
  }

  /**
   * Restore a drill-down path. `lines` (v1.3.0) is preferred because renaming
   * a node keeps its line number; titles are the fallback.
   */
  applyNavigation(titles: string[], page: number, lines?: number[]): void {
    if (titles && titles.length >= 2) {
      const stack: OutlineNode[] = [this.outline.root];
      let cur = this.outline.root;
      for (let i = 1; i < titles.length; i += 1) {
        let next: OutlineNode | undefined;
        if (lines && lines[i] >= 0) {
          next = cur.children.find((c) => c.line === lines[i]);
        }
        if (!next) next = cur.children.find((c) => c.title === titles[i]);
        if (!next) break;
        stack.push(next);
        cur = next;
      }
      if (stack.length > 1) this.stack = stack;
    }
    // Restore the page even when the user never drilled down.
    // v1.3.1: allow ONE virtual page beyond the real children (the always
    // visible "9–16 editing page"), so a re-render does not bounce back.
    this.page = Math.min(
      Math.max(0, page),
      totalPages(this.center.children.length)
    );
  }

  /**
   * Follow the caret of the Markdown pane: the caret's nearest outline node
   * becomes the mandala centre. With mode "parent" a leaf node falls back to
   * its parent and the grid pans to the page containing that leaf.
   * Returns true only when something visible actually changed.
   */
  focusAtLine(line: number, mode: "self" | "parent" = "self"): boolean {
    const target = findNodeAtLine(this.outline.root, line);
    let centre: OutlineNode = target;
    let page = 0;
    if (mode === "parent" && target.children.length === 0 && target.parent) {
      centre = target.parent;
      const idx = centre.children.indexOf(target);
      if (idx >= 0) page = Math.floor(idx / PAGE_SIZE);
    }
    const path = nodePath(centre);
    const nextStack = path.length ? path : [this.outline.root];
    const sameStack =
      nextStack.length === this.stack.length &&
      nextStack.every((n, i) => n.line === this.stack[i].line);
    const same =
      sameStack && this.page === page && this.focusNodeLine === target.line;

    this.stack = nextStack;
    this.page = clampPage(page, this.center.children.length);
    this.focusLine = line;
    this.focusNodeLine = target.line;
    return !same;
  }

  getFocusNodeLine(): number {
    return this.focusNodeLine;
  }

  clearFocus(): void {
    this.focusLine = -1;
    this.focusNodeLine = -1;
  }

  /** Full (uncompressed) dotted path of the current center node. */
  centerPath(): string {
    const parts: string[] = [];
    for (let i = 1; i < this.stack.length; i += 1) {
      const parent = this.stack[i - 1];
      const node = this.stack[i];
      const at = parent.children.indexOf(node);
      parts.push(String(at < 0 ? 1 : at + 1));
    }
    return parts.join(".");
  }

  /** Fixed grid coordinate label (1.1–1.8) of a slot under current config. */
  slotLabel(slot: number): string {
    const p = this.slots[slot] || SLOT_POS[slot];
    return cellLabel(p[0], p[1]);
  }

  /** Hierarchical number of the child currently shown in a slot. */
  slotNumber(slot: number): string {
    return childNumber(this.centerPath(), this.page * PAGE_SIZE + slot + 1);
  }

  private globalIndex(slot: number): number {
    return this.page * PAGE_SIZE + slot;
  }

  private get dragEnabled(): boolean {
    return !!this.opts.onReorder && this.opts.enableDragReorder !== false;
  }

  /** Half of the cell closer to the neighbour we want to insert AFTER. */
  private dropAfter(cell: HTMLElement, e: DragEvent): boolean {
    const rect = (cell as HTMLElement).getBoundingClientRect?.();
    if (!rect || !rect.width || !rect.height) return false;
    const dx = (e.clientX || 0) - (rect.left + rect.width / 2);
    const dy = (e.clientY || 0) - (rect.top + rect.height / 2);
    return Math.abs(dx) >= Math.abs(dy) ? dx > 0 : dy > 0;
  }

  private clearDropMark(): void {
    if (!this.dropMark) return;
    const el = this.dropMark.cell as HTMLElement & {
      removeClass?: (...c: string[]) => void;
    };
    if (typeof el.removeClass === "function") {
      el.removeClass("enm-drop-target", "enm-drop-before", "enm-drop-after");
    }
    this.dropMark = null;
  }

  private markDrop(cell: HTMLElement, after: boolean): void {
    if (
      this.dropMark &&
      (this.dropMark.cell !== cell || this.dropMark.after !== after)
    ) {
      this.clearDropMark();
    }
    cell.addClass("enm-drop-target");
    cell.addClass(after ? "enm-drop-after" : "enm-drop-before");
    this.dropMark = { cell, after };
  }

  /** Make a filled cell draggable. */
  private attachDragSource(cell: HTMLElement, slot: number): void {
    if (!this.dragEnabled) return;
    const gi = this.globalIndex(slot);
    cell.addClass("enm-cell-draggable");
    cell.setAttr("draggable", "true");
    cell.addEventListener("dragstart", (e) => {
      this.dragFrom = gi;
      cell.addClass("enm-drag-source");
      try {
        const dt = (e as DragEvent).dataTransfer;
        if (dt) {
          dt.effectAllowed = "move";
          dt.setData("text/plain", String(gi));
        }
      } catch (_e) {
        /* some hosts disallow dataTransfer; dragFrom still works */
      }
    });
    cell.addEventListener("dragend", () => {
      this.dragFrom = null;
      this.clearDropMark();
      const el = cell as HTMLElement & {
        removeClass?: (...c: string[]) => void;
      };
      if (typeof el.removeClass === "function") el.removeClass("enm-drag-source");
    });
  }

  /** Make any cell (filled or empty) a drop target. */
  private attachDropTarget(cell: HTMLElement, slot: number): void {
    if (!this.dragEnabled) return;
    const gi = this.globalIndex(slot);
    cell.addEventListener("dragover", (e) => {
      if (this.dragFrom === null) return;
      e.preventDefault();
      const de = e as DragEvent;
      try {
        if (de.dataTransfer) de.dataTransfer.dropEffect = "move";
      } catch (_e) {
        /* ignore */
      }
      this.markDrop(cell, this.dropAfter(cell, de));
    });
    cell.addEventListener("drop", (e) => {
      if (this.dragFrom === null) return;
      e.preventDefault();
      e.stopPropagation();
      const after = this.dropAfter(cell, e as DragEvent);
      const from = this.dragFrom;
      this.dragFrom = null;
      this.clearDropMark();
      this.opts.onReorder!(from, gi, after);
    });
  }

  /**
   * v1.3.1: the centre cell is a drop target with a different meaning —
   * dropping a child here promotes it one level up (sibling of the centre).
   * Only bound when the centre itself has a parent (the root cannot absorb
   * a promoted sibling) and drag-reorder is enabled.
   */
  private attachCenterDrop(cell: HTMLElement): void {
    if (!this.dragEnabled || !this.opts.onPromoteNode) return;
    if (!this.center.parent) return;
    cell.addClass("enm-center-droptarget");
    cell.setAttr(
      "title",
      tr("dropCenterHint")
    );
    cell.addEventListener("dragover", (e) => {
      if (this.dragFrom === null) return;
      e.preventDefault();
      const de = e as DragEvent;
      try {
        if (de.dataTransfer) de.dataTransfer.dropEffect = "move";
      } catch (_e) {
        /* ignore */
      }
      this.markCenterDrop(cell);
    });
    cell.addEventListener("drop", (e) => {
      if (this.dragFrom === null) return;
      e.preventDefault();
      e.stopPropagation();
      const from = this.dragFrom;
      this.dragFrom = null;
      this.clearDropMark();
      this.opts.onPromoteNode!(from);
    });
  }

  /** Whole-cell highlight for the centre drop target (no before/after). */
  private markCenterDrop(cell: HTMLElement): void {
    if (this.dropMark && this.dropMark.cell !== cell) this.clearDropMark();
    cell.addClass("enm-drop-target");
    this.dropMark = { cell, after: false };
  }

  private cancelPendingLocate(): void {
    if (this.pendingLocate !== null) {
      window.clearTimeout(this.pendingLocate);
      this.pendingLocate = null;
    }
  }

  render(): void {
    this.cancelPendingLocate();
    this.host.empty();
    this.host.addClass("enm-root");

    const toolbar = this.host.createDiv({ cls: "enm-toolbar" });
    this.renderToolbar(toolbar);

    const grid = this.host.createDiv({ cls: "enm-grid" });
    this.renderGrid(grid);
  }

  private renderToolbar(bar: HTMLElement): void {
    const left = bar.createDiv({ cls: "enm-toolbar-left" });

    const up = left.createEl("button", { cls: "enm-btn", text: tr("backUp") });
    up.setAttr("aria-label", tr("backUpAria"));
    up.disabled = this.stack.length <= 1;
    up.addEventListener("click", () => {
      if (this.stack.length <= 1) return;
      this.stack.pop();
      this.page = 0;
      this.noteOpen.clear();
      this.render();
    });

    const crumb = left.createSpan({ cls: "enm-crumb" });
    const names = this.stack.map((n) => n.title || tr("untitled"));
    crumb.setText(names.join("  ›  ") || this.outline.fileTitle);

    const right = bar.createDiv({ cls: "enm-toolbar-right" });
    // v1.3.1: 虚拟页（9–16 编辑页）也计入总页数显示。
    const pages = Math.max(this.totalPages, this.page + 1);
    if (pages > 1 || this.page > 0) {
      const prev = right.createEl("button", { cls: "enm-btn", text: "‹" });
      prev.setAttr("aria-label", tr("prevPage"));
      prev.disabled = this.page <= 0;
      prev.addEventListener("click", () => {
        this.page = clampPage(this.page - 1, this.center.children.length);
        this.render();
      });
      right.createSpan({
        cls: "enm-pageinfo",
        text: `${this.page + 1} / ${pages}`,
      });
      const next = right.createEl("button", { cls: "enm-btn", text: "›" });
      next.setAttr("aria-label", tr("nextPage"));
      next.disabled = this.page >= this.totalPages;
      next.addEventListener("click", () => {
        this.page = clampPage(this.page + 1, this.center.children.length);
        this.render();
      });
    }
    const count = this.center.children.length;
    right.createSpan({ cls: "enm-countinfo", text: tr("childCount", { n: count }) });
    if (this.focusLine >= 0) {
      right.createSpan({ cls: "enm-follow-badge", text: tr("followCursorBadge") });
    }

    if (this.opts.onOpenMarkdown) {
      const md = right.createEl("button", { cls: "enm-btn", text: "MD ↗" });
      md.setAttr("aria-label", tr("openNoteAria"));
      md.addEventListener("click", () => this.opts.onOpenMarkdown!());
    }
  }

  private renderGrid(grid: HTMLElement): void {
    const children = this.center.children;
    // v1.3.1: no clamping — a page beyond the real children is a virtual
    // "9–16 editing page" of empty (addable) cells.
    const slice = children.slice(
      this.page * PAGE_SIZE,
      this.page * PAGE_SIZE + PAGE_SIZE
    );

    // center cell (row 1, col 1)
    // v1.3.1: centre notes follow the global "show notes" setting by default,
    // just like the surrounding cells. The centre toggle overrides it until
    // the next drill-down resets the override.
    const centerNotesOpen =
      this.centerOpen === null ? this.opts.showNotes : this.centerOpen;
    const centerCell = this.makeCell(1, 1, "enm-cell-center");
    const following = this.focusNodeLine >= 0 && this.center.line === this.focusNodeLine;
    if (following) centerCell.addClass("enm-cell-focus");
    const centerNum = compactNumber(this.centerPath());
    if (centerNum) {
      centerCell.createDiv({ cls: "enm-cell-index", text: centerNum });
    }
    centerCell.createDiv({ cls: "enm-cell-label", text: "CENTER" });
    const centerEditable = this.stack.length > 1 && !!this.opts.onEditNode;
    const cTitle = centerCell.createDiv({
      cls: "enm-cell-title enm-center-title",
      text: this.center.title || this.outline.fileTitle,
    });
    cTitle.setAttr(
      "title",
      centerEditable
        ? tr("centerTitleEditable", { title: this.center.title })
        : this.center.title
    );
    if (centerEditable) {
      cTitle.addEventListener("dblclick", (e) => {
        if (this.isInteractive(e)) return;
        e.stopPropagation();
        this.cancelPendingLocate();
        this.opts.onEditNode!(this.center);
      });
      // 双击中心格空白区域同样进入编辑，与环绕格保持一致。
      centerCell.addEventListener("dblclick", (e) => {
        if (this.isInteractive(e) || this.targetMatches(e, ".enm-cell-title")) return;
        this.cancelPendingLocate();
        this.opts.onEditNode!(this.center);
      });
      const edit = centerCell.createEl("button", {
        cls: "enm-cell-edit enm-center-edit",
        text: "✎",
      });
      edit.setAttr("aria-label", tr("editCenterAria"));
      edit.addEventListener("click", () => this.opts.onEditNode!(this.center));
    }
    this.addNoteBlock(centerCell, this.center, "center", centerNotesOpen);

    const centerLinks = centerCell.createDiv({ cls: "enm-cell-links" });
    if (this.stack.length > 1) {
      const back = centerLinks.createEl("a", {
        cls: "enm-link",
        text: tr("backUpLink"),
        href: "#",
      });
      back.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.stack.pop();
        this.page = 0;
        this.noteOpen.clear();
        this.render();
      });
    }
    if (children.length === 0) {
      centerCell.createDiv({ cls: "enm-empty-hint", text: tr("noChildren") });
    }

    const toggleCenter = centerCell.createEl("button", {
      cls: "enm-cell-toggle",
      text: centerNotesOpen ? "⌃" : "⌄",
    });
    toggleCenter.setAttr("aria-label", tr("toggleCenterNotesAria"));
    toggleCenter.addEventListener("click", () => {
      this.centerOpen = !centerNotesOpen;
      this.render();
    });

    if (this.opts.singleClickLocate && this.opts.onLocate) {
      centerCell.addClass("enm-cell-locatable");
      centerCell.addEventListener("click", (e) => {
        if (this.isInteractive(e)) return;
        this.cancelPendingLocate();
        this.opts.onLocate!(this.center);
      });
    }
    // 拖拽子节点到中心格 = 上升一级（与中心同级）。根中心不绑定。
    this.attachCenterDrop(centerCell);
    grid.appendChild(centerCell);

    // 8 surrounding cells
    for (let slot = 0; slot < PAGE_SIZE; slot += 1) {
      const [r, c] = this.slots[slot];
      const node = slice[slot];
      const key = `p${this.page}-s${slot}`;
      const cell = this.makeCell(r, c, node ? "enm-cell-filled" : "enm-cell-empty");
      if (node && this.focusNodeLine >= 0 && node.line === this.focusNodeLine) {
        cell.addClass("enm-cell-focus");
      }
      // Top-left: hierarchical number (follows first-slot + direction config).
      cell.createDiv({
        cls: `enm-cell-index${node ? "" : " enm-cell-index-empty"}`,
        text: this.slotNumber(slot),
      });
      // Top-right: fixed grid coordinate, optional to avoid two competing numbers.
      if (this.opts.showSlotCoords) {
        cell.createDiv({ cls: "enm-cell-label", text: cellLabel(r, c) });
      }

      if (!node) {
        // Empty cell: double-click to create a new child node in the note.
        if (this.opts.onAddNode) {
          cell.addClass("enm-cell-addable");
          cell.setAttr("title", tr("addChildTitle"));
          cell.createDiv({ cls: "enm-add-hint", text: tr("addChildHint") });
          cell.addEventListener("dblclick", (e) => {
            if (this.isInteractive(e)) return;
            this.cancelPendingLocate();
            this.opts.onAddNode!(slot);
          });
        }
        // last slot can still host pagination links
        if (slot === PAGE_SIZE - 1) this.addPageLinks(cell);
        this.attachDropTarget(cell, slot);
        grid.appendChild(cell);
        continue;
      }

      cell.addClass("enm-cell-locatable");
      const hasSub = node.children.length > 0;
      const title = cell.createDiv({ cls: "enm-cell-title", text: node.title });
      title.setAttr(
        "title",
        hasSub
          ? tr("cellTitleWithChildren", { slot: this.slotNumber(slot), title: node.title, sub: node.children.length })
          : tr("cellTitleLeaf", { slot: this.slotNumber(slot), title: node.title })
      );
      // 标题双击：无下级 -> 以该叶节点为中心进入九宫格（可继续加子节点）；
      // 有下级 -> 不响应，统一走左下「下级 N」单击进入。
      title.addEventListener("dblclick", (e) => {
        if (this.isInteractive(e)) return;
        e.stopPropagation();
        this.cancelPendingLocate();
        if (!hasSub) this.drillInto(node);
      });

      // 节点空白区域双击 -> 编辑标题与备注（右下 ✎ 是同一操作的备用入口）。
      if (this.opts.onEditNode) {
        cell.addEventListener("dblclick", (e) => {
          if (
            this.isInteractive(e) ||
            this.targetMatches(e, ".enm-cell-title, .enm-childcount")
          ) {
            return;
          }
          this.cancelPendingLocate();
          this.opts.onEditNode!(node);
        });
      }

      // 节点空白区域单击 -> 在分屏 Markdown 中定位。延时以让双击取消它。
      if (this.opts.singleClickLocate && this.opts.onLocate) {
        cell.addEventListener("click", (e) => {
          if (this.isInteractive(e) || this.targetMatches(e, ".enm-childcount")) return;
          this.cancelPendingLocate();
          this.pendingLocate = window.setTimeout(() => {
            this.pendingLocate = null;
            this.opts.onLocate!(node);
          }, 230);
        });
      }

      const override = this.noteOpen.get(key);
      const isOpen = override === undefined ? this.opts.showNotes : override;
      this.addNoteBlock(cell, node, key, isOpen);

      // last slot of the sequence also carries "more / back" links
      if (slot === PAGE_SIZE - 1) this.addPageLinks(cell);

      // 左下「下级 N」单击进入下一级，取代原来的 ⤵ 图标。
      const sub = node.children.length;
      if (sub > 0) {
        const childCount = cell.createDiv({
          cls: "enm-childcount enm-childcount-drill",
          text: tr("childrenN", { n: sub }),
        });
        childCount.setAttr("title", tr("enterNextLevel"));
        childCount.setAttr("aria-label", tr("enterAsCenterAria"));
        childCount.addEventListener("click", (e) => {
          e.stopPropagation();
          this.cancelPendingLocate();
          // detail > 1 是双击的第二次 click，忽略以免重复下钻。
          if ((e as MouseEvent).detail > 1) return;
          this.drillInto(node);
        });
      }

      const toggle = cell.createEl("button", {
        cls: "enm-cell-toggle",
        text: isOpen ? "⌃" : "⌄",
      });
      toggle.setAttr("aria-label", tr("toggleNotesAria"));
      toggle.setAttr("title", tr("toggleNotesTitle"));
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        this.noteOpen.set(key, !isOpen);
        this.render();
      });

      if (this.opts.onLocate) {
        const locate = cell.createEl("button", {
          cls: "enm-cell-locate",
          text: "↗",
        });
        locate.setAttr("aria-label", tr("locateAria"));
        locate.addEventListener("click", () => this.opts.onLocate!(node, true));
      }

      // ✎ 编辑图标保留：与「双击空白处」等价。
      if (this.opts.onEditNode) {
        const edit = cell.createEl("button", {
          cls: "enm-cell-edit",
          text: "✎",
        });
        edit.setAttr("aria-label", tr("editNodeAria"));
        edit.addEventListener("click", () => this.opts.onEditNode!(node));
      }

      this.attachDragSource(cell, slot);
      this.attachDropTarget(cell, slot);
      grid.appendChild(cell);
    }
  }

  /** Whether the event originated inside an element matching `selector`. */
  private targetMatches(e: Event, selector: string): boolean {
    const t = e && (e.target as HTMLElement | null);
    if (!t || typeof t.closest !== "function") return false;
    return !!t.closest(selector);
  }

  /** Ignore clicks on a link / button / form control / v1.3.2 thumbnail. */
  private isInteractive(e: Event): boolean {
    return this.targetMatches(e, "a, button, input, textarea, img, .enm-cell-links");
  }

  private makeCell(row: number, col: number, extra: string): HTMLElement {
    const cell = createDiv({ cls: `enm-cell ${extra}` });
    cell.style.gridRow = String(row + 1);
    cell.style.gridColumn = String(col + 1);
    return cell;
  }

  private addNoteBlock(
    cell: HTMLElement,
    node: OutlineNode,
    key: string,
    visible: boolean
  ): void {
    void key;
    if (!visible) return;
    // Thumbnails ON -> notes with image syntax stripped; OFF -> the exact
    // 1.3.1 plain-text preview (nothing silently disappears).
    const thumbsOn = this.opts.showThumbnails === true;
    const text = thumbsOn
      ? notePreview(node, this.opts.noteMaxChars)
      : notePreviewRaw(node, this.opts.noteMaxChars);
    if (text) {
      const box = cell.createDiv({ cls: "enm-notes" });
      box.setText(text);
      box.setAttr("title", text);
    }

    // v1.3.2: thumbnails are opt-in via GridOptions so older DOM harnesses
    // keep rendering pure text. A node may have images but no note text.
    if (!thumbsOn) return;
    const refs = (node.images || []).slice(0, MAX_THUMBS_PER_CELL);
    if (!refs.length) return;

    const rawH = Number(this.opts.thumbMaxHeight);
    const maxH = Number.isFinite(rawH) && rawH > 0
      ? Math.max(32, Math.min(320, rawH))
      : 96;
    const wrap = cell.createDiv({ cls: "enm-thumbs" });
    wrap.setAttr("style", `--enm-thumb-max-h:${maxH}px`);

    // Keep resolved URLs in JS (not DOM attributes) so a fake-DOM harness can
    // assert the preview payload, and async block refs can join the list late.
    const resolved: Array<PreviewImage | null> = refs.map(() => null);
    const openAt = (i: number) => {
      const current = resolved[i];
      if (!current || !this.opts.onPreviewImage) return;
      const all = resolved.filter((x): x is PreviewImage => !!x);
      const index = resolved.slice(0, i + 1).filter(
        (x): x is PreviewImage => !!x
      ).length - 1;
      this.opts.onPreviewImage!(all, Math.max(0, index));
    };

    refs.forEach((ref, i) => {
      const img = wrap.createEl("img", { cls: "enm-thumb" });
      const label = ref.kind === "block"
        ? `[[${ref.src}#^${ref.blockId}]]`
        : ref.src || ref.alt || tr("imageFallback");
      img.setAttr("alt", ref.alt || tr("imageAlt"));
      img.setAttr("title", label);
      img.setAttr("aria-label", tr("imageZoomTitle"));
      img.setAttr("loading", "lazy");
      img.addEventListener("error", () => img.addClass("enm-thumb-failed"));
      img.addEventListener("click", (e) => {
        e.stopPropagation();
        this.cancelPendingLocate();
        openAt(i);
      });

      const direct = this.opts.resolveImageSrc
        ? this.opts.resolveImageSrc(ref)
        : ref.kind === "external" ? ref.src : null;
      if (direct) {
        img.setAttr("src", direct);
        resolved[i] = { src: direct, label };
        return;
      }
      if (ref.kind === "block" && this.opts.resolveBlockImage) {
        void this.opts
          .resolveBlockImage(ref)
          .then((src) => {
            // render() may have rebuilt the grid while the file was read.
            if ((img as unknown as { isConnected?: boolean }).isConnected === false) return;
            if (src) {
              img.setAttr("src", src);
              resolved[i] = { src, label };
            } else img.addClass("enm-thumb-failed");
          })
          .catch(() => img.addClass("enm-thumb-failed"));
        return;
      }
      img.addClass("enm-thumb-failed");
    });
  }

  private addPageLinks(cell: HTMLElement): void {
    const box = cell.createDiv({ cls: "enm-cell-links" });
    if (this.page > 0) {
      const back = box.createEl("a", {
        cls: "enm-link",
        text: tr("backLink"),
        href: "#",
      });
      back.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.page = clampPage(this.page - 1, this.center.children.length);
        this.noteOpen.clear();
        this.render();
      });
    }
    // v1.3.1: 常驻「更多子节点」链接——第 8 格无论有无内容都显示，
    // 指向下一批（9–16 / 17–24 …），点击翻到下一页（可为虚拟空页，
    // 在那里双击空格新建的节点仍按顺序排在最后一个有内容节点之后）。
    const [from, to] = moreRange(this.center.children.length, this.page);
    const more = box.createEl("a", {
      cls: "enm-link enm-link-more",
      text: tr("moreChildren", { from, to }),
      href: "#",
    });
    more.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.page = this.page + 1;
      this.noteOpen.clear();
      this.render();
    });
  }

  private drillInto(node: OutlineNode): void {
    // 叶节点也允许下钻：以它为中心得到空九宫格，可在空格双击继续加子节点。
    // 双击「下级 N」时浏览器会连发两次 click；已是中心则忽略，避免重复入栈。
    if (this.center === node) return;
    this.stack.push(node);
    this.page = 0;
    this.noteOpen.clear();
    // v1.3.1: drop the manual override so the new centre follows the setting.
    this.centerOpen = null;
    this.render();
  }
}

// ------------------------------------------------------------------ //
// Image lightbox (v1.3.2 patch): click a thumbnail to view it full size.
// ------------------------------------------------------------------ //

class ImageLightbox extends Modal {
  private images: PreviewImage[];
  private index: number;
  private imgEl: HTMLElement | null = null;
  private counterEl: HTMLElement | null = null;
  private captionEl: HTMLElement | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(app: App, images: PreviewImage[], index: number) {
    super(app);
    this.images = (images || []).filter((x) => !!x && !!x.src);
    this.index = Math.max(0, Math.min(index, this.images.length - 1));
  }

  private draw(): void {
    const cur = this.images[this.index];
    if (!cur) return;
    if (this.imgEl) this.imgEl.setAttr("src", cur.src);
    if (this.counterEl) {
      this.counterEl.setText(tr("imageLightboxCounter", {
        i: this.index + 1,
        n: this.images.length,
      }));
    }
    if (this.captionEl) this.captionEl.setText(cur.label);
  }

  private step(delta: number): void {
    this.index = previewIndex(this.index, delta, this.images.length);
    this.draw();
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("enm-lightbox-modal");
    modalEl.setAttr("style", "max-width:94vw;width:auto;");
    contentEl.addClass("enm-lightbox-content");
    contentEl.setAttr("style", "padding:0;background:transparent;box-shadow:none;");

    const stage = contentEl.createDiv({ cls: "enm-lightbox-stage" });
    const bar = stage.createDiv({ cls: "enm-lightbox-bar" });
    this.counterEl = bar.createSpan({ cls: "enm-lightbox-counter" });
    const close = bar.createEl("button", {
      cls: "enm-lightbox-close",
      text: "✕",
    });
    close.setAttr("aria-label", tr("imageLightboxClose"));
    close.addEventListener("click", () => this.close());

    const body = stage.createDiv({ cls: "enm-lightbox-body" });
    if (this.images.length > 1) {
      const prev = body.createEl("button", { cls: "enm-lightbox-nav", text: "‹" });
      prev.setAttr("aria-label", tr("imageLightboxPrev"));
      prev.addEventListener("click", (e) => { e.stopPropagation(); this.step(-1); });
    }
    this.imgEl = body.createEl("img", { cls: "enm-lightbox-img" });
    this.imgEl.setAttr("alt", tr("imageAlt"));
    this.imgEl.addEventListener("error", () => this.imgEl?.addClass("enm-lightbox-failed"));
    if (this.images.length > 1) {
      const next = body.createEl("button", { cls: "enm-lightbox-nav", text: "›" });
      next.setAttr("aria-label", tr("imageLightboxNext"));
      next.addEventListener("click", (e) => { e.stopPropagation(); this.step(1); });
    }

    this.captionEl = stage.createDiv({ cls: "enm-lightbox-caption" });
    stage.createDiv({ cls: "enm-lightbox-hint", text: tr("imageLightboxHint") });
    this.draw();

    stage.addEventListener("click", (e) => {
      if (e.target === stage) this.close();
    });
    modalEl.addEventListener("click", (e) => {
      if (e.target === modalEl) this.close();
    });
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") this.step(-1);
      else if (e.key === "ArrowRight") this.step(1);
    };
    if (typeof document !== "undefined" &&
        typeof document.addEventListener === "function") {
      document.addEventListener("keydown", this.keyHandler);
    }
  }

  onClose(): void {
    if (this.keyHandler && typeof document !== "undefined" &&
        typeof document.removeEventListener === "function") {
      document.removeEventListener("keydown", this.keyHandler);
    }
    this.keyHandler = null;
  }
}

// ------------------------------------------------------------------ //
// Node modal (create on an empty cell / edit on a filled cell)
// ------------------------------------------------------------------ //

interface NodeModalOptions {
  mode: "create" | "edit";
  hint: string;
  title?: string;
  notes?: string[];
  onSubmit: (spec: NewNodeSpec) => void;
}

class NodeModal extends Modal {
  private opts: NodeModalOptions;
  private titleValue: string;
  private noteValue: string;
  private titleInput: HTMLInputElement | null = null;
  private noteInput: HTMLTextAreaElement | null = null;

  constructor(app: App, opts: NodeModalOptions) {
    super(app);
    this.opts = opts;
    this.titleValue = opts.title || "";
    this.noteValue = (opts.notes || []).join("\n");
  }

  onOpen(): void {
    const { contentEl } = this;
    const editing = this.opts.mode === "edit";
    contentEl.addClass("enm-modal");
    if (editing) contentEl.addClass("enm-modal-editing");
    // 新建/编辑同构：无大标题，第一行「标题 + 输入框」，其下「备注 + 输入框」，
    // 说明折叠在最后（native details/summary 提供下拉三角，默认收起）。

    new Setting(contentEl).setName(tr("modalTitle")).addText((t) => {
      t.setPlaceholder(tr("modalTitlePlaceholder"))
        .setValue(this.titleValue)
        .onChange((v) => {
          this.titleValue = v;
        });
      this.titleInput = t.inputEl;
    });

    const wrap = contentEl.createDiv({ cls: "enm-modal-notes-wrap" });
    wrap.createDiv({ cls: "enm-modal-label", text: tr("modalNotes") });
    const ta = wrap.createEl("textarea", {
      cls: "enm-modal-notes",
      attr: {
        rows: "6",
        placeholder: tr("modalNotesPlaceholder"),
      },
    }) as HTMLTextAreaElement;
    ta.value = this.noteValue;
    this.noteInput = ta;
    ta.addEventListener("input", () => {
      this.noteValue = ta.value;
    });

    if (this.opts.hint) {
      const details = contentEl.createEl("details", {
        cls: "enm-modal-hint-details",
      });
      details.createEl("summary", { text: editing ? tr("editHintLabel") : tr("createHintLabel") });
      details.createDiv({ cls: "enm-modal-hint", text: this.opts.hint });
    }

    const bar = contentEl.createDiv({ cls: "enm-modal-actions" });
    const cancel = bar.createEl("button", { cls: "enm-btn", text: tr("cancel") });
    cancel.addEventListener("click", () => this.close());
    const ok = bar.createEl("button", {
      cls: "enm-btn mod-cta",
      text: editing ? tr("saveEdit") : tr("addNode"),
    });
    ok.addEventListener("click", () => this.submit());

    // Escape is handled by Obsidian's Modal itself.
    contentEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.submit();
      } else if (e.key === "Enter" && e.target === this.titleInput) {
        e.preventDefault();
        this.noteInput?.focus();
      }
    });

    window.setTimeout(() => this.titleInput?.focus(), 0);
  }

  private submit(): void {
    const title = (this.titleValue || "").trim();
    if (!title) {
      new Notice(tr("noticeTitleRequired"));
      this.titleInput?.focus();
      return;
    }
    const notes = (this.noteValue || "").split(/\r?\n/);
    this.close();
    this.opts.onSubmit({ title, notes });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ------------------------------------------------------------------ //
// ItemView
// ------------------------------------------------------------------ //

class MandalaView extends ItemView {
  private plugin: NineGoPlugin;
  private file: TFile | null = null;
  private grid: MandalaGrid | null = null;
  private lastCursorLine = -1;
  private flash = new LocateFlash();
  private flashDelayTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: NineGoPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getFilePath(): string | null {
    return this.file?.path ?? null;
  }

  /** Driven by the plugin's caret watcher; cheap no-op when the line is unchanged. */
  followCursor(line: number): void {
    if (!this.grid || !this.file) return;
    if (this.lastCursorLine === line) return;
    this.lastCursorLine = line;
    const s = this.plugin.settings;
    if (this.grid.focusAtLine(line, s.followCursorMode)) this.grid.render();
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file ? tr("viewTitle", { name: this.file.basename }) : tr("viewTitleEmpty");
  }

  getIcon(): string {
    return ICON;
  }

  async setState(state: unknown, _result: any): Promise<void> {
    const st = state as { file?: string } | null;
    if (st && typeof st.file === "string") {
      await this.loadFile(st.file);
    }
    await super.setState(state, _result);
  }

  getState(): Record<string, unknown> {
    return { file: this.file?.path ?? null };
  }

  async onOpen(): Promise<void> {
    this.registerEvent(
      this.app.vault.on("modify", (f) => {
        if (this.file && f.path === this.file.path) {
          this.scheduleReload();
        }
      })
    );
    this.contentEl.addClass("enm-view");
    if (!this.file) this.renderEmpty();
  }

  async onClose(): Promise<void> {
    this.cancelFlashDelay();
    this.flash.clear();
    this.contentEl.empty();
  }

  private timer: number | null = null;
  private scheduleReload(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (this.file) void this.renderFile(this.file);
    }, 400);
  }

  private renderEmpty(): void {
    this.contentEl.empty();
    this.contentEl.createDiv({
      cls: "enm-empty",
      text: tr("noFileSpecified"),
    });
  }

  private async loadFile(path: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) {
      this.renderEmpty();
      return;
    }
    this.file = f;
    await this.renderFile(f);
  }

  private async renderFile(file: TFile): Promise<void> {
    // Preserve drill-down / page across re-renders (vault "modify" events).
    const prevTitles = this.grid ? this.grid.getStackTitles() : [];
    const prevLines = this.grid ? this.grid.getStackLines() : [];
    const prevPage = this.grid ? this.grid.getPage() : 0;
    const prevNoteOpen = this.grid ? this.grid.getNoteOverrides() : [];
    const text = await this.app.vault.cachedRead(file);
    const s = this.plugin.settings;
    const outline = parseOutline(text, {
      fileTitle: file.basename,
      rootSource: s.rootSource,
    });
    this.contentEl.empty();
    const host = this.contentEl.createDiv({ cls: "enm-host" });
    const grid = new MandalaGrid(host, outline, {
      showNotes: s.showNotes,
      noteMaxChars: s.noteMaxChars,
      // v1.3.2: thumbnails in the full-screen view (source = current file).
      showThumbnails: s.showThumbnails,
      thumbMaxHeight: s.thumbMaxHeight,
      resolveImageSrc: (ref) => imageSrc(this.app, ref, file.path),
      resolveBlockImage: (ref) => blockImageSrc(this.app, ref, file.path),
      onPreviewImage: (images, index) =>
        new ImageLightbox(this.app, images, index).open(),
      autoCollapseSingleRoot: s.autoCollapseSingleRoot,
      singleClickLocate: s.singleClickLocate,
      slots: buildSlots(s.firstSlot, s.sortDirection),
      showSlotCoords: s.showSlotCoords,
      enableDragReorder: s.enableDragReorder,
      onLocate: (node, force) => void this.locate(node, !!force),
      onAddNode: (slot) => void this.addNode(slot),
      onEditNode: (node) => void this.editNode(node),
      onReorder: (from, target, after) => void this.reorderNodes(from, target, after),
      onPromoteNode: (from) => void this.promoteNode(from),
      onOpenMarkdown: () => {
        if (this.file) {
          void this.app.workspace.getLeaf("tab").openFile(this.file, { active: true });
        }
      },
    });
    grid.applyNavigation(prevTitles, prevPage, prevLines);
    grid.applyNoteOverrides(prevNoteOpen);
    if (s.followCursor && this.lastCursorLine >= 0) {
      grid.focusAtLine(this.lastCursorLine, s.followCursorMode);
    }
    grid.render();
    this.grid = grid;
    // keep the tab title in sync
    setTimeout(() => {
      if (this.leaf?.tabHeaderInnerTitleEl) {
        this.leaf.tabHeaderInnerTitleEl.setText(this.getDisplayText());
      }
    }, 0);
  }

  /** Locate another leaf (a split pane or a background tab) showing the file. */
  private findMarkdownLeaf(path: string): WorkspaceLeaf | null {
    let found: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (found || leaf === this.leaf) return;
      const v = leaf.view;
      if (v instanceof MarkdownView && v.file && v.file.path === path) {
        found = leaf;
      }
    });
    return found;
  }

  /**
   * Reveal a node in the Markdown pane and flash its heading line like an
   * Obsidian search hit. Focus stays on the grid, so consecutive clicks keep
   * driving the Markdown pane.
   */
  private async locate(node: OutlineNode, forceOpen = false): Promise<void> {
    if (!this.file) return;
    const path = this.file.path;
    let leaf: WorkspaceLeaf | null = null;
    let activate = false;

    if (forceOpen) {
      leaf = this.app.workspace.getLeaf("tab");
      activate = true;
    } else {
      leaf = this.findMarkdownLeaf(path);
      if (!leaf) {
        const mode = this.plugin.settings.locateFallback;
        if (mode === "none") {
          this.notifyNoMarkdownOnce();
          return;
        }
        leaf = this.app.workspace.getLeaf(mode === "split" ? "split" : "tab");
        activate = true;
      }
    }
    if (!leaf) return;

    if (activate) {
      await leaf.openFile(this.file, { active: true });
    } else if (leaf.view.getViewType() !== "markdown") {
      await leaf.openFile(this.file, { active: false });
    }

    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    const line = Math.max(0, node.line);
    try {
      if (view.editor) {
        view.editor.setCursor({ line, ch: 0 });
        view.editor.scrollIntoView(
          { from: { line, ch: 0 }, to: { line, ch: 0 } },
          true
        );
      }
    } catch (_e) {
      /* reading view may not expose a live editor */
    }

    // CodeMirror only renders visible lines; wait a frame after scrolling.
    // Any previously queued flash is cancelled, so a rapid sequence of
    // clicks cannot let an older timeout cut a newer highlight short.
    this.cancelFlashDelay();
    this.flashDelayTimer = window.setTimeout(() => {
      this.flashDelayTimer = null;
      this.flashLine(view, node);
    }, 80);
  }

  private cancelFlashDelay(): void {
    if (this.flashDelayTimer !== null) {
      window.clearTimeout(this.flashDelayTimer);
      this.flashDelayTimer = null;
    }
  }

  private noMarkdownNotified = false;
  private notifyNoMarkdownOnce(): void {
    if (this.noMarkdownNotified) return;
    this.noMarkdownNotified = true;
    new Notice(tr("noMarkdownView"));
  }

  /**
   * Find the DOM element currently rendering `node.line`. LocateFlash's
   * guard re-runs this lookup, so a rebuilt `.cm-line` can be found again
   * without importing any CodeMirror symbol.
   */
  private findLineElement(view: MarkdownView, node: OutlineNode): HTMLElement | null {
    try {
      const cm = (view.editor as unknown as { cm?: any })?.cm;
      if (view.contentEl && cm && cm.state && typeof cm.domAtPos === "function") {
        const maxLine = cm.state.doc.lines;
        const pos = cm.state.doc.line(Math.min(node.line + 1, maxLine)).from;
        const at = cm.domAtPos(pos);
        let n: any = at && at.node;
        while (n && n !== cm.dom) {
          if (n.nodeType === 1 && n.classList && n.classList.contains("cm-line")) {
            return n as HTMLElement;
          }
          n = n.parentNode;
        }
      }
    } catch (_e) {
      /* fall through to heading-text matching */
    }

    // Reading mode / non-CM fallback: match the visible heading text.
    try {
      const heads = view.contentEl.querySelectorAll(
        "h1, h2, h3, h4, h5, h6, .cm-header, .cm-line"
      );
      const wanted = (node.title || "").trim();
      for (let i = 0; i < heads.length; i += 1) {
        const h = heads[i] as HTMLElement;
        if (wanted && (h.textContent || "").trim().indexOf(wanted) >= 0) return h;
      }
    } catch (_e) {
      /* the view may be closing */
    }
    return null;
  }

  private flashLine(view: MarkdownView, node: OutlineNode): void {
    if (!view.contentEl) return;
    const find = () => this.findLineElement(view, node);
    const el = find();
    if (!el) return;
    // Duration is read at click time, so changing the setting takes effect
    // on the very next locate without reloading the plugin. Normalise stale
    // / hand-edited data.json values: setTimeout(NaN) would fire at 0ms and
    // reproduce the "flashes and is gone" symptom.
    const raw = Number(this.plugin.settings.highlightDuration);
    const duration = Number.isFinite(raw)
      ? Math.min(10000, Math.max(300, raw))
      : 1400;
    this.flash.start(view.contentEl, el, find, duration);
  }

  /** Double-click on an empty cell -> collect title + notes, write to file. */
  private async addNode(slot: number): Promise<void> {
    if (!this.file || !this.grid) return;
    const center = this.grid.center;
    const index = center.children.length + 1;
    const crumb = this.grid.getStackTitles().join(" › ");
    const hint = tr("createHint", {
      slot: this.grid.slotNumber(slot),
      crumb,
      index,
      number: childNumber(this.grid.centerPath(), index),
    });
    new NodeModal(this.app, {
      mode: "create",
      hint,
      onSubmit: (spec) => void this.writeNode(spec),
    }).open();
  }

  private async writeNode(spec: NewNodeSpec): Promise<void> {
    const file = this.file;
    if (!file || !this.grid) return;
    try {
      const text = await this.app.vault.read(file);
      const s = this.plugin.settings;
      const fresh = parseOutline(text, {
        fileTitle: file.basename,
        rootSource: s.rootSource,
      });
      const center =
        findNodeByLine(fresh.root, this.grid.center.line) ?? fresh.root;
      const next = insertChildNode(text, center, spec, s.newNodeNoteStyle);
      if (next === text) {
        new Notice(tr("noticeNotWritten"));
        return;
      }
      await this.app.vault.modify(file, next);
      new Notice(tr("noticeAdded", { title: spec.title }));
    } catch (e) {
      new Notice(tr("noticeWriteFailed") + (e instanceof Error ? e.message : String(e)));
    }
  }

  /**
   * Double-click (or ✎) on a FILLED cell -> edit that node's title + notes.
   * The root (file title) has no Markdown line, so it is not editable here.
   */
  private async editNode(node: OutlineNode): Promise<void> {
    const file = this.file;
    if (!file) return;
    if (!node.parent) {
      new Notice(tr("noticeRootNoLine"));
      return;
    }
    try {
      const text = await this.app.vault.cachedRead(file);
      const s = this.plugin.settings;
      const fresh = parseOutline(text, {
        fileTitle: file.basename,
        rootSource: s.rootSource,
      });
      const target = findNodeByLine(fresh.root, node.line);
      if (!target || !target.parent) {
        new Notice(tr("noticeNodeNotFound"));
        return;
      }
      const styleText = s.newNodeNoteStyle === "callout" ? tr("styleCallout") : tr("styleParagraph");
      const hint = tr("editHint", { title: target.title, style: styleText });
      new NodeModal(this.app, {
        mode: "edit",
        title: target.title,
        // v1.3.2 patch: raw notes keep image embeds / links / block ids,
        // so they are visible AND editable in the textarea. Passing the
        // cleaned `target.notes` here used to show an empty box and made a
        // no-op save DELETE the image line from the Markdown file.
        notes: nodeEditNotes(target),
        hint,
        onSubmit: (spec) => void this.writeNodeEdit(target.line, spec),
      }).open();
    } catch (e) {
      new Notice(tr("noticeReadFailed") + (e instanceof Error ? e.message : String(e)));
    }
  }

  private async writeNodeEdit(line: number, spec: NewNodeSpec): Promise<void> {
    const file = this.file;
    if (!file) return;
    try {
      const text = await this.app.vault.read(file);
      const s = this.plugin.settings;
      const fresh = parseOutline(text, {
        fileTitle: file.basename,
        rootSource: s.rootSource,
      });
      const target = findNodeByLine(fresh.root, line);
      if (!target || !target.parent) {
        new Notice(tr("noticeNodeChanged"));
        return;
      }
      const next = updateNode(text, target, spec, s.newNodeNoteStyle);
      if (next === text) {
        new Notice(tr("noticeNoChange"));
        return;
      }
      await this.app.vault.modify(file, next);
      new Notice(tr("noticeUpdated", { title: spec.title }));
    } catch (e) {
      new Notice(tr("noticeUpdateFailed") + (e instanceof Error ? e.message : String(e)));
    }
  }

  /** Drag & drop: move one direct child of the current center to a new slot. */
  private async reorderNodes(
    from: number,
    target: number,
    after: boolean
  ): Promise<void> {
    const file = this.file;
    if (!file || !this.grid) return;
    const center = this.grid.center;
    const n = center.children.length;
    if (from < 0 || from >= n) return;
    const tgt = Math.min(n - 1, Math.max(0, target));
    const finalAt = dropFinalAt(from, tgt, after);
    if (finalAt === from) return;
    const order = moveIndices(n, from, finalAt);
    try {
      const text = await this.app.vault.read(file);
      const s = this.plugin.settings;
      const fresh = parseOutline(text, {
        fileTitle: file.basename,
        rootSource: s.rootSource,
      });
      const freshCenter =
        findNodeByLine(fresh.root, center.line) ?? fresh.root;
      const next = reorderChildren(text, freshCenter, order);
      if (next === text) return;
      await this.app.vault.modify(file, next);
      new Notice(tr("noticeReordered", { from: from + 1, to: finalAt + 1 }));
    } catch (e) {
      new Notice(tr("noticeReorderFailed") + (e instanceof Error ? e.message : String(e)));
    }
  }

  /**
   * v1.3.1: 把当前中心的一个子节点拖到中心格 → 上升一级，
   * 移出中心层级，成为与中心节点同级的下一个兄弟节点。
   */
  private async promoteNode(from: number): Promise<void> {
    const file = this.file;
    if (!file || !this.grid) return;
    const center = this.grid.center;
    if (!center.parent) {
      new Notice(tr("noticeRootAlready"));
      return;
    }
    const node = center.children[from];
    if (!node) return;
    try {
      const text = await this.app.vault.read(file);
      const s = this.plugin.settings;
      const fresh = parseOutline(text, {
        fileTitle: file.basename,
        rootSource: s.rootSource,
      });
      const freshCenter = findNodeByLine(fresh.root, center.line);
      if (!freshCenter || !freshCenter.parent) {
        new Notice(tr("noticeNodeNotFound"));
        return;
      }
      if (from < 0 || from >= freshCenter.children.length) return;
      const moved = freshCenter.children[from];
      const next = promoteChildNode(text, freshCenter, from);
      if (next === text) {
        new Notice(tr("noticeCannotPromote"));
        return;
      }
      await this.app.vault.modify(file, next);
      new Notice(tr("noticePromoted", { title: moved.title, center: freshCenter.title }));
    } catch (e) {
      new Notice(tr("noticePromoteFailed") + (e instanceof Error ? e.message : String(e)));
    }
  }
}

// ------------------------------------------------------------------ //
// Plugin
// ------------------------------------------------------------------ //

export default class NineGoPlugin extends Plugin {
  settings: NineGoSettings = DEFAULT_SETTINGS;
  private autoOpened = new Set<string>();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new MandalaView(leaf, this));
    this.addSettingTab(new NineGoSettingTab(this.app, this));

    this.addCommand({
      id: "9go-open",
      name: tr("commandOpen"),
      callback: () => this.openActive(true),
    });
    this.addCommand({
      id: "9go-replace",
      name: tr("commandSwitch"),
      callback: () => this.openActive(false),
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
        if (!(file instanceof TFile)) return;
        menu.addItem((item) => {
          item
            .setTitle(tr("commandMenu"))
            .setIcon(ICON)
            .onClick(() => void this.openFile(file, true));
        });
      })
    );

    // embedded ```mandala code blocks
    this.registerMarkdownCodeBlockProcessor("mandala", (source, el, ctx) => {
      const outline = parseOutline(source, { fileTitle: tr("embedTitle") });
      const host = el.createDiv({ cls: "enm-embed" });
      host.style.height = `${this.settings.embedHeight}px`;
      const sourcePath =
        (ctx as unknown as { sourcePath?: string }).sourcePath || "";
      const grid = new MandalaGrid(host, outline, {
        showNotes: this.settings.showNotes,
        noteMaxChars: this.settings.noteMaxChars,
        // v1.3.2: thumbnails also work in embedded ```mandala blocks.
        showThumbnails: this.settings.showThumbnails,
        thumbMaxHeight: this.settings.thumbMaxHeight,
        resolveImageSrc: (ref) => imageSrc(this.app, ref, sourcePath),
        resolveBlockImage: (ref) => blockImageSrc(this.app, ref, sourcePath),
        onPreviewImage: (images, index) =>
          new ImageLightbox(this.app, images, index).open(),
        autoCollapseSingleRoot: this.settings.autoCollapseSingleRoot,
        slots: buildSlots(this.settings.firstSlot, this.settings.sortDirection),
        showSlotCoords: this.settings.showSlotCoords,
      });
      grid.render();
    });

    // auto-open notes marked with the trigger keyword
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!this.settings.autoOpen) return;
        if (!(file instanceof TFile)) return;
        if (this.autoOpened.has(file.path)) return;
        window.setTimeout(() => void this.tryAutoOpen(file), 60);
      })
    );

    // Caret watcher. Poll the active MarkdownView instead of importing
    // @codemirror/view: a missing/external CM6 symbol would break main.js load.
    this.registerInterval(window.setInterval(() => this.tickFollowCursor(), 250));

    console.log("[9go] loaded, view:", VIEW_TYPE);
  }

  /**
   * Every 250ms read the caret line of the active Markdown view and drive all
   * mandala views bound to the same file. No focus change, no file writes.
   */
  private tickFollowCursor(): void {
    if (!this.settings.followCursor) return;
    let view: MarkdownView | null = null;
    try {
      view = this.app.workspace.getActiveViewOfType(MarkdownView);
    } catch (_e) {
      return;
    }
    if (!view || !view.file || !view.editor) return;
    let line = 0;
    try {
      const cur = view.editor.getCursor();
      if (!cur) return;
      line = cur.line;
    } catch (_e) {
      return;
    }
    const path = view.file.path;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const v = leaf.view;
      if (v instanceof MandalaView && v.getFilePath() === path) {
        v.followCursor(line);
      }
    }
  }

  onunload(): void {
    this.autoOpened.clear();
  }

  private async tryAutoOpen(file: TFile): Promise<void> {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) return;
    if (leaf.view?.getViewType?.() !== "markdown") return;
    if (!(await this.hasMarker(file))) return;
    this.autoOpened.add(file.path);
    await leaf.setViewState({
      type: VIEW_TYPE,
      state: { file: file.path },
      active: true,
    });
  }

  private async openActive(newTab: boolean): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice(tr("noticeOpenMdFirst"));
      return;
    }
    await this.openFile(file, newTab);
  }

  private async openFile(file: TFile, newTab: boolean): Promise<void> {
    const leaf = newTab
      ? this.app.workspace.getLeaf("tab")
      : (this.app.workspace.activeLeaf ?? this.app.workspace.getLeaf(false));
    await leaf.setViewState({
      type: VIEW_TYPE,
      state: { file: file.path },
      active: true,
    });
  }

  /** frontmatter / inline marker detection */
  async hasMarker(file: TFile): Promise<boolean> {
    const words = this.settings.keywords
      .split(/[,，\s]+/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    if (!words.length) return false;

    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
      | Record<string, unknown>
      | undefined;
    if (fm) {
      for (const [k, v] of Object.entries(fm)) {
        const key = k.toLowerCase();
        if (words.includes(key) && (v === true || v === "true" || v === 1)) {
          return true;
        }
        if (typeof v === "string" && words.some((w) => v.toLowerCase().includes(w))) {
          return true;
        }
      }
    }
    try {
      const text = await this.app.vault.cachedRead(file);
      for (const w of words) {
        if (new RegExp(`%%[^%]{0,60}${escapeRe(w)}[^%]{0,60}%%`, "i").test(text)) {
          return true;
        }
      }
    } catch (_e) {
      /* ignore */
    }
    return false;
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    setLanguage(this.settings.language);
  }

  async saveSettings(): Promise<void> {
    setLanguage(this.settings.language);
    await this.saveData(this.settings);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof MandalaView) {
        // re-render by re-applying current state
        void view.setState(view.getState(), {});
      }
    }
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ------------------------------------------------------------------ //
// Settings tab
// ------------------------------------------------------------------ //

class NineGoSettingTab extends PluginSettingTab {
  private plugin: NineGoPlugin;

  constructor(app: App, plugin: NineGoPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: tr("settingsTitle") });

    // v1.3.2: UI language. saveSettings() re-renders every open Mandala
    // view, so only this settings tab needs an explicit repaint.
    new Setting(containerEl)
      .setName(tr("setLanguage"))
      .setDesc(tr("setLanguageDesc"))
      .addDropdown((d) =>
        d
          .addOption("zh", tr("optLangZh"))
          .addOption("en", tr("optLangEn"))
          .addOption("auto", tr("optLangAuto"))
          .setValue(this.plugin.settings.language)
          .onChange(async (v) => {
            this.plugin.settings.language = v as Lang;
            await this.plugin.saveSettings();
            window.setTimeout(() => this.display(), 0);
          })
      );

    new Setting(containerEl)
      .setName(tr("setKeywords"))
      .setDesc(tr("setKeywordsDesc"))
      .addText((t) =>
        t
          .setPlaceholder("mandala")
          .setValue(this.plugin.settings.keywords)
          .onChange(async (v) => {
            this.plugin.settings.keywords = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(tr("setAutoOpen"))
      .setDesc(tr("setAutoOpenDesc"))
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoOpen).onChange(async (v) => {
          this.plugin.settings.autoOpen = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(tr("setShowNotes"))
      .setDesc(tr("setShowNotesDesc"))
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showNotes).onChange(async (v) => {
          this.plugin.settings.showNotes = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(tr("setNoteMaxChars"))
      .setDesc(tr("setNoteMaxCharsDesc"))
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.noteMaxChars))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            this.plugin.settings.noteMaxChars = Number.isFinite(n) ? Math.max(0, n) : 120;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(tr("setThumbnails"))
      .setDesc(
        tr("setThumbnailsDesc")
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showThumbnails).onChange(async (v) => {
          this.plugin.settings.showThumbnails = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(tr("setThumbMaxHeight"))
      .setDesc(tr("setThumbMaxHeightDesc"))
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.thumbMaxHeight))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            this.plugin.settings.thumbMaxHeight = Number.isFinite(n)
              ? Math.max(32, Math.min(320, n))
              : 96;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(tr("setRootSource"))
      .setDesc(tr("setRootSourceDesc"))
      .addDropdown((d) =>
        d
          .addOption("filename", tr("optFilename"))
          .addOption("firstH1", tr("optFirstH1"))
          .setValue(this.plugin.settings.rootSource)
          .onChange(async (v) => {
            this.plugin.settings.rootSource = v as "filename" | "firstH1";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(tr("setAutoCollapse"))
      .setDesc(tr("setAutoCollapseDesc"))
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.autoCollapseSingleRoot)
          .onChange(async (v) => {
            this.plugin.settings.autoCollapseSingleRoot = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(tr("setEmbedHeight"))
      .setDesc(tr("setEmbedHeightDesc"))
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.embedHeight))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            this.plugin.settings.embedHeight = Number.isFinite(n) ? Math.max(200, n) : 460;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: tr("secLayout") });

    new Setting(containerEl)
      .setName(tr("setFirstSlot"))
      .setDesc(tr("setFirstSlotDesc"))
      .addDropdown((d) => {
        for (const key of FIRST_SLOT_ORDER) {
          d.addOption(key, slotLabel(key));
        }
        d.setValue(this.plugin.settings.firstSlot).onChange(async (v) => {
          this.plugin.settings.firstSlot = v as FirstSlot;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(tr("setSortDirection"))
      .setDesc(tr("setSortDirectionDesc"))
      .addDropdown((d) =>
        d
          .addOption("cw", tr("optCw"))
          .addOption("ccw", tr("optCcw"))
          .setValue(this.plugin.settings.sortDirection)
          .onChange(async (v) => {
            this.plugin.settings.sortDirection = v as SortDirection;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(tr("setSlotCoords"))
      .setDesc(tr("setSlotCoordsDesc"))
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showSlotCoords).onChange(async (v) => {
          this.plugin.settings.showSlotCoords = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(tr("setDragReorder"))
      .setDesc(tr("setDragReorderDesc"))
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enableDragReorder).onChange(async (v) => {
          this.plugin.settings.enableDragReorder = v;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("p", {
      cls: "enm-setting-note",
      text: tr("numberingNote"),
    });

    containerEl.createEl("h3", { text: tr("secInteraction") });

    new Setting(containerEl)
      .setName(tr("setFollowCursor"))
      .setDesc(tr("setFollowCursorDesc"))
      .addToggle((t) =>
        t.setValue(this.plugin.settings.followCursor).onChange(async (v) => {
          this.plugin.settings.followCursor = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(tr("setFollowLeaf"))
      .setDesc(tr("setFollowLeafDesc"))
      .addDropdown((d) =>
        d
          .addOption("parent", tr("optParent"))
          .addOption("self", tr("optSelf"))
          .setValue(this.plugin.settings.followCursorMode)
          .onChange(async (v) => {
            this.plugin.settings.followCursorMode = v as "self" | "parent";
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("p", {
      cls: "enm-setting-note",
      text: tr("interactionNote"),
    });

    new Setting(containerEl)
      .setName(tr("setNoteStyle"))
      .setDesc(tr("setNoteStyleDesc"))
      .addDropdown((d) =>
        d
          .addOption("callout", tr("optCallout"))
          .addOption("paragraph", tr("optParagraph"))
          .setValue(this.plugin.settings.newNodeNoteStyle)
          .onChange(async (v) => {
            this.plugin.settings.newNodeNoteStyle = v as NewNodeNoteStyle;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(tr("setSingleClick"))
      .setDesc(tr("setSingleClickDesc"))
      .addToggle((t) =>
        t.setValue(this.plugin.settings.singleClickLocate).onChange(async (v) => {
          this.plugin.settings.singleClickLocate = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(tr("setHighlight"))
      .setDesc(tr("setHighlightDesc"))
      .addText((t) => {
        const commit = (raw: string, save: boolean): void => {
          const n = parseInt(raw, 10);
          this.plugin.settings.highlightDuration = Number.isFinite(n)
            ? Math.min(10000, Math.max(300, n))
            : 1400;
          if (save) void this.plugin.saveSettings();
        };
        t.setValue(String(this.plugin.settings.highlightDuration))
          .setPlaceholder("1400")
          .onChange((v) => {
            // Live in-memory value only. Saving on every keystroke would
            // clamp/save 300, 300, 300, 2500 while typing "2500" and
            // re-render every open grid four times.
            const n = parseInt(v, 10);
            if (Number.isFinite(n) && n >= 300 && n <= 10000) {
              this.plugin.settings.highlightDuration = n;
            }
          });
        const input = (t as unknown as { inputEl?: HTMLInputElement }).inputEl;
        if (input) {
          input.type = "number";
          input.min = "300";
          input.max = "10000";
          input.step = "100";
          input.addEventListener("change", () => {
            commit(t.getValue(), true);
            t.setValue(String(this.plugin.settings.highlightDuration));
          });
        } else {
          t.onChange((v) => commit(v, true));
        }
      });

    new Setting(containerEl)
      .setName(tr("setFallback"))
      .setDesc(tr("setFallbackDesc"))
      .addDropdown((d) =>
        d
          .addOption("split", tr("optSplit"))
          .addOption("tab", tr("optTab"))
          .addOption("none", tr("optNone"))
          .setValue(this.plugin.settings.locateFallback)
          .onChange(async (v) => {
            this.plugin.settings.locateFallback = v as "none" | "split" | "tab";
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: tr("secUsage") });
    const ul = containerEl.createEl("ul");
    ul.createEl("li", { text: tr("usage1") });
    ul.createEl("li", { text: tr("usage2") });
    ul.createEl("li", { text: tr("usage3") });
    ul.createEl("li", { text: tr("usage4") });
    ul.createEl("li", { text: tr("usage5") });
    ul.createEl("li", { text: tr("usage6") });
    ul.createEl("li", { text: tr("usage7") });
    ul.createEl("li", { text: tr("usage8") });
    ul.createEl("li", { text: tr("usage9") });
    ul.createEl("li", { text: tr("usage10") });
    ul.createEl("li", { text: tr("usage11") });

    containerEl.createEl("h3", { text: tr("secReference") });
    new Setting(containerEl)
      .setName(tr("setReference"))
      .setDesc(
        tr("setReferenceDesc")
      )
      .addButton((b) =>
        b.setButtonText(tr("openGitHub")).onClick(() => {
          window.open(REFERENCE_REPO_URL, "_blank");
        })
      );
  }
}

/** Exposed for Node-side regression tests; harmless in Obsidian. */
export { MandalaGrid, LocateFlash, previewIndex };
