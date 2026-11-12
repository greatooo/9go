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
  findNodeAtLine,
  findNodeByLine,
  insertChildNode,
  nodePath,
  notePreview,
  parseOutline,
  promoteChildNode,
  reorderChildren,
  updateNode,
  type NewNodeSpec,
  type NewNodeNoteStyle,
  type Outline,
  type OutlineNode,
} from "./parser";
import {
  buildSlots,
  cellLabel,
  childNumber,
  clampPage,
  compactNumber,
  dropFinalAt,
  FIRST_SLOT_LABEL,
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
  followCursor: boolean;
  followCursorMode: "self" | "parent";
}

const DEFAULT_SETTINGS: NineGoSettings = {
  autoOpen: true,
  keywords: "mandala",
  showNotes: false,
  noteMaxChars: 120,
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
// Grid renderer (shared by the ItemView and the ```mandala code block)
// ------------------------------------------------------------------ //

interface GridOptions {
  showNotes: boolean;
  noteMaxChars: number;
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
  private expanded = new Set<string>();
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
      "拖动子节点到这里：上升一级，与中心节点同级"
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

    const up = left.createEl("button", { cls: "enm-btn", text: "↑ 返回上级" });
    up.setAttr("aria-label", "返回上级九宫格");
    up.disabled = this.stack.length <= 1;
    up.addEventListener("click", () => {
      if (this.stack.length <= 1) return;
      this.stack.pop();
      this.page = 0;
      this.expanded.clear();
      this.render();
    });

    const crumb = left.createSpan({ cls: "enm-crumb" });
    const names = this.stack.map((n) => n.title || "(未命名)");
    crumb.setText(names.join("  ›  ") || this.outline.fileTitle);

    const right = bar.createDiv({ cls: "enm-toolbar-right" });
    // v1.3.1: 虚拟页（9–16 编辑页）也计入总页数显示。
    const pages = Math.max(this.totalPages, this.page + 1);
    if (pages > 1 || this.page > 0) {
      const prev = right.createEl("button", { cls: "enm-btn", text: "‹" });
      prev.setAttr("aria-label", "上一页");
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
      next.setAttr("aria-label", "下一页");
      next.disabled = this.page >= this.totalPages;
      next.addEventListener("click", () => {
        this.page = clampPage(this.page + 1, this.center.children.length);
        this.render();
      });
    }
    const count = this.center.children.length;
    right.createSpan({ cls: "enm-countinfo", text: `${count} 个子节点` });
    if (this.focusLine >= 0) {
      right.createSpan({ cls: "enm-follow-badge", text: "⌖ 跟随光标" });
    }

    if (this.opts.onOpenMarkdown) {
      const md = right.createEl("button", { cls: "enm-btn", text: "MD ↗" });
      md.setAttr("aria-label", "在 Markdown 中打开本笔记");
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
        ? `${this.center.title}（双击编辑标题与备注）`
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
      edit.setAttr("aria-label", "编辑中心节点标题与备注");
      edit.addEventListener("click", () => this.opts.onEditNode!(this.center));
    }
    this.addNoteBlock(centerCell, this.center, "center", centerNotesOpen);

    const centerLinks = centerCell.createDiv({ cls: "enm-cell-links" });
    if (this.stack.length > 1) {
      const back = centerLinks.createEl("a", {
        cls: "enm-link",
        text: "← 返回上级",
        href: "#",
      });
      back.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.stack.pop();
        this.page = 0;
        this.expanded.clear();
        this.render();
      });
    }
    if (children.length === 0) {
      centerCell.createDiv({ cls: "enm-empty-hint", text: "（无下级节点）" });
    }

    const toggleCenter = centerCell.createEl("button", {
      cls: "enm-cell-toggle",
      text: centerNotesOpen ? "⌃" : "⌄",
    });
    toggleCenter.setAttr("aria-label", "展开/收起中心备注");
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
          cell.setAttr("title", "双击添加子节点（标题 + 备注）");
          cell.createDiv({ cls: "enm-add-hint", text: "+ 双击添加" });
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
          ? `${this.slotNumber(slot)} ${node.title}（单击左下「下级 ${node.children.length}」进入下一级；单击空白处定位 MD；双击空白处编辑；拖动可调整同级顺序）`
          : `${this.slotNumber(slot)} ${node.title}（双击标题进入以其为中心的九宫格；单击空白处定位 MD；双击空白处编辑；拖动可调整同级顺序）`
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

      const isOpen = this.expanded.has(key) || this.opts.showNotes;
      this.addNoteBlock(cell, node, key, isOpen);

      // last slot of the sequence also carries "more / back" links
      if (slot === PAGE_SIZE - 1) this.addPageLinks(cell);

      // 左下「下级 N」单击进入下一级，取代原来的 ⤵ 图标。
      const sub = node.children.length;
      if (sub > 0) {
        const childCount = cell.createDiv({
          cls: "enm-childcount enm-childcount-drill",
          text: `下级 ${sub}`,
        });
        childCount.setAttr("title", "单击进入下一级九宫格");
        childCount.setAttr("aria-label", "以该节点为中心进入下级");
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
      toggle.setAttr("aria-label", "展开/收起备注");
      toggle.addEventListener("click", () => {
        if (this.expanded.has(key)) this.expanded.delete(key);
        else this.expanded.add(key);
        this.render();
      });

      if (this.opts.onLocate) {
        const locate = cell.createEl("button", {
          cls: "enm-cell-locate",
          text: "↗",
        });
        locate.setAttr("aria-label", "在 Markdown 中打开并定位");
        locate.addEventListener("click", () => this.opts.onLocate!(node, true));
      }

      // ✎ 编辑图标保留：与「双击空白处」等价。
      if (this.opts.onEditNode) {
        const edit = cell.createEl("button", {
          cls: "enm-cell-edit",
          text: "✎",
        });
        edit.setAttr("aria-label", "编辑节点标题与备注");
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

  /** Ignore clicks that originate on a link / button / form control. */
  private isInteractive(e: Event): boolean {
    return this.targetMatches(e, "a, button, input, textarea, .enm-cell-links");
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
    const text = notePreview(node, this.opts.noteMaxChars);
    if (!text) return;
    if (!visible) return;
    const box = cell.createDiv({ cls: "enm-notes" });
    box.setText(text);
    box.setAttr("title", text);
    void key;
  }

  private addPageLinks(cell: HTMLElement): void {
    const box = cell.createDiv({ cls: "enm-cell-links" });
    if (this.page > 0) {
      const back = box.createEl("a", {
        cls: "enm-link",
        text: "← 返回",
        href: "#",
      });
      back.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.page = clampPage(this.page - 1, this.center.children.length);
        this.expanded.clear();
        this.render();
      });
    }
    // v1.3.1: 常驻「更多子节点」链接——第 8 格无论有无内容都显示，
    // 指向下一批（9–16 / 17–24 …），点击翻到下一页（可为虚拟空页，
    // 在那里双击空格新建的节点仍按顺序排在最后一个有内容节点之后）。
    const [from, to] = moreRange(this.center.children.length, this.page);
    const more = box.createEl("a", {
      cls: "enm-link enm-link-more",
      text: `更多子节点 (${from}–${to}) ›`,
      href: "#",
    });
    more.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.page = this.page + 1;
      this.expanded.clear();
      this.render();
    });
  }

  private drillInto(node: OutlineNode): void {
    // 叶节点也允许下钻：以它为中心得到空九宫格，可在空格双击继续加子节点。
    // 双击「下级 N」时浏览器会连发两次 click；已是中心则忽略，避免重复入栈。
    if (this.center === node) return;
    this.stack.push(node);
    this.page = 0;
    this.expanded.clear();
    // v1.3.1: drop the manual override so the new centre follows the setting.
    this.centerOpen = null;
    this.render();
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

    new Setting(contentEl).setName("标题").addText((t) => {
      t.setPlaceholder("输入标题…")
        .setValue(this.titleValue)
        .onChange((v) => {
          this.titleValue = v;
        });
      this.titleInput = t.inputEl;
    });

    const wrap = contentEl.createDiv({ cls: "enm-modal-notes-wrap" });
    wrap.createDiv({ cls: "enm-modal-label", text: "备注" });
    const ta = wrap.createEl("textarea", {
      cls: "enm-modal-notes",
      attr: { rows: "6", placeholder: "输入备注内容，每行一条…" },
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
      details.createEl("summary", { text: editing ? "编辑说明" : "新建说明" });
      details.createDiv({ cls: "enm-modal-hint", text: this.opts.hint });
    }

    const bar = contentEl.createDiv({ cls: "enm-modal-actions" });
    const cancel = bar.createEl("button", { cls: "enm-btn", text: "取消" });
    cancel.addEventListener("click", () => this.close());
    const ok = bar.createEl("button", {
      cls: "enm-btn mod-cta",
      text: editing ? "保存修改" : "添加节点",
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
      new Notice("请填写节点标题");
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
    return this.file ? `九宫格 · ${this.file.basename}` : "九宫格 · Mandala";
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
      text: "未指定笔记。请通过命令面板「以九宫格打开当前笔记」或在笔记 frontmatter 加 mandala: true。",
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
    new Notice("未找到同一笔记的 Markdown 视图；可在设置里把「无分屏时」改为自动分屏或新标签。");
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
    const hint =
      `你双击了编号 ${this.grid.slotNumber(slot)} 的空格。新节点按顺序追加为` +
      `「${crumb}」的第 ${index} 个子节点，编号 ${childNumber(this.grid.centerPath(), index)}` +
      `；前面的格子未满 8 个时，会自动排在最后一个有内容的节点之后（不占用「更多子节点」格）。` +
      `标题与备注会写回当前笔记。`;
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
        new Notice("未写入：节点标题为空。");
        return;
      }
      await this.app.vault.modify(file, next);
      new Notice(`已添加子节点「${spec.title}」`);
    } catch (e) {
      new Notice("写入节点失败：" + (e instanceof Error ? e.message : String(e)));
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
      new Notice("笔记标题（根中心）没有对应的 Markdown 行，请在 Markdown 中修改文件名或第一个标题。");
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
        new Notice("未找到该节点对应的 Markdown 行，请刷新九宫格后重试。");
        return;
      }
      const styleText = s.newNodeNoteStyle === "callout" ? "> 引用块" : "普通段落";
      const hint =
        `正在编辑「${target.title}」。标题与备注会写回当前笔记；备注按当前设置以 ${styleText} ` +
        `重写（下级节点、兄弟节点、frontmatter 不受影响）。标题未改动时原行原样保留。`;
      new NodeModal(this.app, {
        mode: "edit",
        title: target.title,
        notes: target.notes,
        hint,
        onSubmit: (spec) => void this.writeNodeEdit(target.line, spec),
      }).open();
    } catch (e) {
      new Notice("读取笔记失败：" + (e instanceof Error ? e.message : String(e)));
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
        new Notice("节点已变化，未写入。");
        return;
      }
      const next = updateNode(text, target, spec, s.newNodeNoteStyle);
      if (next === text) {
        new Notice("节点内容没有变化。");
        return;
      }
      await this.app.vault.modify(file, next);
      new Notice(`已更新节点「${spec.title}」`);
    } catch (e) {
      new Notice("更新节点失败：" + (e instanceof Error ? e.message : String(e)));
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
      new Notice(`已调整顺序：第 ${from + 1} 个 → 第 ${finalAt + 1} 个`);
    } catch (e) {
      new Notice("调整顺序失败：" + (e instanceof Error ? e.message : String(e)));
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
      new Notice("中心已是根节点（笔记标题），子节点无法再上升一级。");
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
        new Notice("未找到该节点对应的 Markdown 行，请刷新九宫格后重试。");
        return;
      }
      if (from < 0 || from >= freshCenter.children.length) return;
      const moved = freshCenter.children[from];
      const next = promoteChildNode(text, freshCenter, from);
      if (next === text) {
        new Notice("未写入：该节点无法上升一级（结构不允许）。");
        return;
      }
      await this.app.vault.modify(file, next);
      new Notice(`已将「${moved.title}」上升一级，与「${freshCenter.title}」同级`);
    } catch (e) {
      new Notice("上升节点失败：" + (e instanceof Error ? e.message : String(e)));
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
      name: "以九宫格（Mandala）打开当前笔记",
      callback: () => this.openActive(true),
    });
    this.addCommand({
      id: "9go-replace",
      name: "九宫格：把当前标签切换为 Mandala 视图",
      callback: () => this.openActive(false),
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
        if (!(file instanceof TFile)) return;
        menu.addItem((item) => {
          item
            .setTitle("以九宫格（Mandala）打开")
            .setIcon(ICON)
            .onClick(() => void this.openFile(file, true));
        });
      })
    );

    // embedded ```mandala code blocks
    this.registerMarkdownCodeBlockProcessor("mandala", (source, el) => {
      const outline = parseOutline(source, { fileTitle: "九宫格" });
      const host = el.createDiv({ cls: "enm-embed" });
      host.style.height = `${this.settings.embedHeight}px`;
      const grid = new MandalaGrid(host, outline, {
        showNotes: this.settings.showNotes,
        noteMaxChars: this.settings.noteMaxChars,
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
      new Notice("请先打开一篇 Markdown 笔记");
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
  }

  async saveSettings(): Promise<void> {
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
    containerEl.createEl("h2", { text: "9go · 九宫格（Mandala）" });

    new Setting(containerEl)
      .setName("触发关键词")
      .setDesc("逗号分隔。frontmatter 键、frontmatter 值或 %%标记%% 命中即识别，默认 mandala。")
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
      .setName("自动打开标记笔记")
      .setDesc("打开含关键词的 Markdown 笔记时，自动把该标签切换为九宫格视图（每个文件每次会话最多一次）。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoOpen).onChange(async (v) => {
          this.plugin.settings.autoOpen = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("默认显示备注")
      .setDesc("每个格子在标题下显示部分备注内容；关闭时可用格子右下角 ⌄ 单独展开。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showNotes).onChange(async (v) => {
          this.plugin.settings.showNotes = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("备注最大字数")
      .setDesc("超出部分以 … 截断，避免格子溢出。")
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
      .setName("中心格标题来源")
      .setDesc("默认显示笔记标题（文件名）；可改为显示第一个一级标题的文字。仅影响显示，不改变层级结构。")
      .addDropdown((d) =>
        d
          .addOption("filename", "笔记标题（文件名）")
          .addOption("firstH1", "第一个一级标题")
          .setValue(this.plugin.settings.rootSource)
          .onChange(async (v) => {
            this.plugin.settings.rootSource = v as "filename" | "firstH1";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("自动折叠单根")
      .setDesc("笔记只有一个一级标题时，自动以该标题为中心、显示其二级节点（仍可返回上级）。")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.autoCollapseSingleRoot)
          .onChange(async (v) => {
            this.plugin.settings.autoCollapseSingleRoot = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("内嵌九宫格高度")
      .setDesc("```mandala 代码块渲染高度（px）。")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.embedHeight))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            this.plugin.settings.embedHeight = Number.isFinite(n) ? Math.max(200, n) : 460;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "排列 · 编号 · 拖动" });

    new Setting(containerEl)
      .setName("第 1 个子节点的位置")
      .setDesc("环绕 8 格中，第 1 个子节点落在哪个方位；其余按排序方向依次排布，格子左上角的层级编号随之同步调整。")
      .addDropdown((d) => {
        for (const key of FIRST_SLOT_ORDER) {
          d.addOption(key, FIRST_SLOT_LABEL[key]);
        }
        d.setValue(this.plugin.settings.firstSlot).onChange(async (v) => {
          this.plugin.settings.firstSlot = v as FirstSlot;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("子节点排序方向")
      .setDesc("从第 1 个节点开始，顺时针或逆时针填满其余格位。")
      .addDropdown((d) =>
        d
          .addOption("cw", "顺时针")
          .addOption("ccw", "逆时针")
          .setValue(this.plugin.settings.sortDirection)
          .onChange(async (v) => {
            this.plugin.settings.sortDirection = v as SortDirection;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("显示格位坐标标签")
      .setDesc("格子右上角额外显示固定坐标 1.1–1.8（与左上角层级编号不同）。默认关闭，避免两套编号混淆。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showSlotCoords).onChange(async (v) => {
          this.plugin.settings.showSlotCoords = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("拖动调整同级顺序")
      .setDesc("拖动子节点到同级两格之间（靠左/上半区=插到它前面，靠右/下半区=插到它后面），同步重排 Markdown 原文中的整段标题与子树。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enableDragReorder).onChange(async (v) => {
          this.plugin.settings.enableDragReorder = v;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("p", {
      cls: "enm-setting-note",
      text: "编号规则：一级 1 / 2 / 3…，二级 1.1 / 1.2…，三级 1.1.1…；超过 3 层压缩为「首段...末两段」，例如第 4 级 1.1.1.1 显示为 1...1.1。",
    });

    containerEl.createEl("h3", { text: "交互 · 光标跟随、编辑与定位" });

    new Setting(containerEl)
      .setName("光标跟随 · 分屏 MD 编辑时自动切换中心")
      .setDesc("开启后每 250ms 读取活动 Markdown 视图的光标行，把同一笔记的九宫格中心切到光标所在标题/列表节点并高亮对应格；不抢焦点、不写文件。需同时打开 MD 与九宫格两个视图。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.followCursor).onChange(async (v) => {
          this.plugin.settings.followCursor = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("光标所在节点没有下级时")
      .setDesc("回退到父级：以父节点为中心、翻到该节点所在页并高亮该格（推荐，叶子节点也能看到同级）；仍以它为中心：严格按光标节点作中心，环绕 8 格为空。")
      .addDropdown((d) =>
        d
          .addOption("parent", "回退到父级并高亮该格（推荐）")
          .addOption("self", "仍以光标节点为中心")
          .setValue(this.plugin.settings.followCursorMode)
          .onChange(async (v) => {
            this.plugin.settings.followCursorMode = v as "self" | "parent";
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("p", {
      cls: "enm-setting-note",
      text:
        "交互分工（固定，不再提供开关）：有下级的节点 → 点左下「下级 N」进入下一级（双击标题不响应）；" +
        "无下级的节点 → 双击标题进入以其为中心的九宫格；单击节点空白处 → 在分屏 Markdown 中定位；" +
        "双击节点空白处（或点右下 ✎）→ 编辑标题与备注；空白格双击 → 新建子节点。",
    });

    new Setting(containerEl)
      .setName("新建节点 · 备注写法")
      .setDesc("双击空白格输入标题与备注，按当前层级写回笔记（九宫格视图中始终可用，内嵌 ```mandala 代码块除外）。列表节点的备注自动缩进一层，避免顶格 > 引用块打断列表，使下级节点在阅读模式里退化成「- 」纯文本。")
      .addDropdown((d) =>
        d
          .addOption("callout", "备注写成 > 引用块（推荐，最安全）")
          .addOption("paragraph", "备注写成普通段落")
          .setValue(this.plugin.settings.newNodeNoteStyle)
          .onChange(async (v) => {
            this.plugin.settings.newNodeNoteStyle = v as NewNodeNoteStyle;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("单击节点联动 Markdown 分屏")
      .setDesc("单击中心格或子格时，跳到同一笔记的 Markdown 视图对应行，并像搜索结果一样高亮一下再淡化。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.singleClickLocate).onChange(async (v) => {
          this.plugin.settings.singleClickLocate = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("高亮持续时间")
      .setDesc("定位后高亮保持的时长（毫秒，300–10000），到时再淡出约 220ms；输入后按回车或点到别处生效。")
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
      .setName("无分屏 Markdown 时")
      .setDesc("找不到同一笔记的 Markdown 视图时：自动分屏 / 新标签打开 / 不处理。")
      .addDropdown((d) =>
        d
          .addOption("split", "自动分屏打开")
          .addOption("tab", "新标签打开")
          .addOption("none", "不处理")
          .setValue(this.plugin.settings.locateFallback)
          .onChange(async (v) => {
            this.plugin.settings.locateFallback = v as "none" | "split" | "tab";
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "用法" });
    const ul = containerEl.createEl("ul");
    ul.createEl("li", { text: "frontmatter：mandala: true 或 mindmap-structure: mandala" });
    ul.createEl("li", { text: "行内标记：%%mandala%%" });
    ul.createEl("li", { text: "内嵌：```mandala 代码块，块内用同样的 Markdown 大纲" });
    ul.createEl("li", { text: "双击空白格 → 输入标题 + 备注，按当前层级写回笔记（追加为最后一个子节点）" });
    ul.createEl("li", { text: "双击已填充格 → 编辑该节点标题 + 备注（可在设置里改回下钻）；✎ / ⤵ 按钮触发另一种操作" });
    ul.createEl("li", { text: "单击中心格 / 子格 → 在分屏 MD 中定位并高亮对应节点行；高亮按「高亮持续时间」设置保持（默认 1400ms）后淡出" });
    ul.createEl("li", { text: "开启「光标跟随」后，MD 光标移动 → 九宫格中心自动切到该节点并高亮对应格（工具栏 ⌖ 标记）" });
    ul.createEl("li", { text: "格子右下角 ↗ → 强制在 Markdown 中打开并定位；中心格「返回上级」回退" });
    ul.createEl("li", { text: "拖动子节点到同级两格之间 → 调整同级顺序并写回 Markdown" });
    ul.createEl("li", { text: "拖动子节点到中心格 → 该节点上升一级，成为与中心同级的下一个兄弟" });
    ul.createEl("li", { text: "序列末格（第 8 格）无论有无内容都常驻「更多子节点 (9–16) ›」，点击进入下一批节点的编辑页；新建节点始终按顺序排在最后一个有内容节点之后" });

    containerEl.createEl("h3", { text: "参考与致谢" });
    new Setting(containerEl)
      .setName("语法与交互参考：gogoga-mindmap")
      .setDesc(
        "本插件的九宫格写法（标题 / 列表 / Tab 备注 / %%标记%%）参考自 JackWeiGogoga 的 gogoga-mindmap，按同一套数据模型独立实现，两个插件可同时启用、互不干扰。源码与文档见其仓库。"
      )
      .addButton((b) =>
        b.setButtonText("打开 GitHub").onClick(() => {
          window.open(REFERENCE_REPO_URL, "_blank");
        })
      );
  }
}

/** Exposed for Node-side regression tests; harmless in Obsidian. */
export { MandalaGrid, LocateFlash };
