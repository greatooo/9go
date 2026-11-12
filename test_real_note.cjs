/**
 * Real-note regression for 9go (2026-11-10 interaction split).
 * Feeds the ACTUAL 0新建未分类/gogoga-思维导图.md into parseOutline + MandalaGrid.
 * No Obsidian required: tiny fake DOM + "obsidian" module stub.
 * Run: node test_real_note.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// ---------------------------------------------------------------- fake DOM
class FakeEl {
  constructor(tag, opts) {
    const o = opts || {};
    this.tag = tag;
    this.children = [];
    this.classes = new Set(String(o.cls || "").split(/\s+/).filter(Boolean));
    this.attrs = {};
    if (o.href !== undefined) this.attrs.href = o.href;
    this._text = o.text === undefined ? "" : String(o.text);
    this.style = {};
    this.listeners = {};
    this.disabled = false;
  }
  addClass(c) { this.classes.add(c); return this; }
  removeClass(...cs) { for (const c of cs) this.classes.delete(c); return this; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; }
  empty() { this.children = []; return this; }
  createDiv(o) { const e = new FakeEl("div", o); this.children.push(e); return e; }
  createSpan(o) { const e = new FakeEl("span", o); this.children.push(e); return e; }
  createEl(tag, o) { const e = new FakeEl(tag, o); this.children.push(e); return e; }
  appendChild(e) { this.children.push(e); return e; }
  setText(t) { this._text = String(t); return this; }
  getText() { return this._text; }
  setAttr(k, v) { this.attrs[k] = v; return this; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
}
global.createDiv = (o) => new FakeEl("div", o);

let timerSeq = 0;
const pendingTimers = new Map();
global.window = {
  setTimeout: (fn, ms) => { const id = ++timerSeq; pendingTimers.set(id, { fn, ms: ms || 0 }); return id; },
  clearTimeout: (id) => pendingTimers.delete(id),
};
function flushTimers() {
  const entries = Array.from(pendingTimers.values());
  pendingTimers.clear();
  for (const e of entries) e.fn();
}

class Base { constructor(..._a) {} }
const stub = {
  App: Base, ItemView: Base, MarkdownView: Base, Menu: Base, Modal: Base,
  Notice: class { constructor(m) { this.msg = m; } }, Plugin: Base,
  PluginSettingTab: Base, Setting: Base, TAbstractFile: Base, TFile: Base,
  WorkspaceLeaf: Base,
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") return stub;
  return origLoad.call(this, request, parent, isMain);
};
const core = require(path.join(__dirname, ".core-test-bundle.cjs"));
const bundle = require(path.join(__dirname, "..", "..", ".obsidian", "plugins", "9go", "main.js"));
Module._load = origLoad;
const { MandalaGrid } = bundle;
const { parseOutline, promoteChildNode, updateNode, notePreview } = core;

function all(el, out) {
  out = out || [];
  out.push(el);
  for (const c of el.children) all(c, out);
  return out;
}
function byClass(root, cls) { return all(root).filter((e) => e.classes.has(cls)); }
function fire(el, type, evt) {
  assert.ok(el, "element missing");
  const fns = el.listeners[type] || [];
  assert.ok(fns.length, "no " + type + " listener");
  for (const fn of fns) fn(evt || {});
}
const clickEvt = { preventDefault() {}, stopPropagation() {} };
const dblEvt = { target: { closest: () => null }, preventDefault() {}, stopPropagation() {} };

const NOTE = path.join(__dirname, "..", "..", "0新建未分类", "gogoga-思维导图.md");
const text = fs.readFileSync(NOTE, "utf8");
const outline = parseOutline(text, { fileTitle: "gogoga-思维导图" });

function mk(opts) {
  const host = new FakeEl("div");
  const grid = new MandalaGrid(host, outline, Object.assign({
    showNotes: false, noteMaxChars: 120, autoCollapseSingleRoot: false,
  }, opts || {}));
  grid.render();
  return { host, grid };
}
function cellOf(host, title) {
  return byClass(host, "enm-cell").find((c) =>
    all(c).some((e) => e.classes.has("enm-cell-title") && e._text === title)
  );
}

let pass = 0;
function t(name, fn) {
  try { fn(); pass += 1; console.log("  PASS  " + name); }
  catch (e) {
    console.error("  FAIL  " + name + " -> " + (e && e.stack ? e.stack.split("\n")[0] : e));
    process.exitCode = 1;
  }
}

console.log("=== 真实笔记样本: " + path.basename(NOTE) + " ===");
console.log("    根=" + outline.root.title + " / 一级子节点=" + outline.root.children.length);

t("真实文档能解析出多个一级子节点", () => {
  assert.ok(outline.root.children.length >= 2);
});

t("有下级的格显示可点「下级 N」，且不再渲染 ⤵", () => {
  const { host } = mk({ onEditNode: () => {} });
  assert.ok(outline.root.children.some((n) => n.children.length > 0));
  const ccs = byClass(host, "enm-childcount-drill");
  assert.ok(ccs.length >= 1, "应渲染可点的下级标记");
  assert.strictEqual(byClass(host, "enm-cell-drill").length, 0);
  console.log("        可点标记数=" + ccs.length + " / 首个=" + ccs[0]._text);
});

t("有下级节点双击标题 -> 不下钻（须点「下级 N」）（真实层级）", () => {
  const target = outline.root.children.find((n) => n.children.length > 0);
  const { host, grid } = mk({ onEditNode: () => {} });
  const cell = cellOf(host, target.title);
  assert.ok(cell, "应能找到 " + target.title + " 的格子");
  fire(all(cell).find((e) => e.classes.has("enm-cell-title")), "dblclick", dblEvt);
  assert.strictEqual(grid.center.title, outline.root.title, "有下级时双击标题不应下钻");
});

t("无下级节点双击标题 -> 以该叶节点为中心（真实层级）", () => {
  const { host, grid } = mk({ onEditNode: () => {} });
  // 在整棵树里找第一个叶节点，沿祖先路径逐层点「下级 N」，再对叶标题双击。
  let leaf = null, path = null;
  const dfs = (n, trail) => {
    if (leaf) return;
    if (n !== outline.root && n.children.length === 0) { leaf = n; path = trail; return; }
    for (const c of n.children) {
      // trail = 需要逐层点「下级 N」的祖先链（根已是中心，排除）。
      dfs(c, n === outline.root ? [] : trail.concat(n));
    }
  };
  dfs(outline.root, []);
  assert.ok(leaf, "整棵树应存在叶节点");
  // path = 从顶层到叶父级的中心链；逐层点对应格子的「下级 N」。
  let cur = outline.root;
  for (const step of path) {
    const cell = cellOf(host, step.title);
    const cc = all(cell).find((e) => e.classes.has("enm-childcount-drill"));
    assert.ok(cc, "路径节点 " + step.title + " 应有可点「下级 N」");
    fire(cc, "click", clickEvt);
    assert.strictEqual(grid.center.title, step.title);
    cur = step;
  }
  const leafCell = cellOf(host, leaf.title);
  assert.ok(leafCell, "应能找到叶节点 " + leaf.title + " 的格子");
  fire(all(leafCell).find((e) => e.classes.has("enm-cell-title")), "dblclick", dblEvt);
  assert.strictEqual(grid.center.title, leaf.title);
  console.log("        叶节点=" + leaf.title + " / 路径=" + path.map((n) => n.title).join(">"));
});

t("点「下级 N」-> 下钻（真实层级）", () => {
  const { host, grid } = mk({ onEditNode: () => {} });
  const cc = byClass(host, "enm-childcount-drill")[0];
  const cell = byClass(host, "enm-cell").find((c) => all(c).includes(cc));
  const title = all(cell).find((e) => e.classes.has("enm-cell-title"))._text;
  fire(cc, "click", clickEvt);
  assert.strictEqual(grid.center.title, title);
  console.log("        下钻中心=" + grid.center.title);
});

t("双击节点空白 -> 编辑，不下钻；单击空白 -> 定位", () => {
  const edits = [], locates = [];
  const target = outline.root.children.find((n) => n.children.length > 0);
  const { host, grid } = mk({
    singleClickLocate: true,
    onEditNode: (n) => edits.push(n.title),
    onLocate: (n) => locates.push(n.title),
  });
  const cell = cellOf(host, target.title);
  fire(cell, "dblclick", dblEvt);
  flushTimers();
  assert.deepStrictEqual(edits, [target.title], "双击空白应触发编辑");
  assert.strictEqual(grid.center.title, outline.root.title, "双击空白不应下钻");
  assert.deepStrictEqual(locates, [], "双击不应定位");

  fire(cell, "click", clickEvt);
  flushTimers();
  assert.deepStrictEqual(locates, [target.title], "单击空白应定位");
});

t("拖到中心 = 上升一级（真实大纲纯文本推演，不写盘）", () => {
  // 找第一个「有下级且其子节点也有下级」的节点作为中心，上升它的第一个子节点。
  let center = null;
  const dfs = (n) => {
    if (center) return;
    if (n !== outline.root && n.children.length > 0 && n.children.some((c) => c.children.length > 0)) {
      center = n; return;
    }
    for (const c of n.children) dfs(c);
  };
  dfs(outline.root);
  assert.ok(center, "真实笔记应存在「子节点还有下级」的节点");
  const promoted = center.children.find((c) => c.children.length > 0);
  const idx = center.children.indexOf(promoted);
  const next = promoteChildNode(text, center, idx);
  assert.notStrictEqual(next, text, "上升应产生新文本");
  const again = parseOutline(next, { fileTitle: "gogoga-思维导图" });
  // 重新解析后：promoted 应出现在 center 的父级的直接子节点里，紧跟 center。
  let c2 = null;
  const find = (n) => { if (c2) return; if (n.line === center.line) { c2 = n; return; } for (const x of n.children) find(x); };
  find(again.root);
  assert.ok(c2 && c2.parent, "中心节点应仍存在且有父级");
  const sibTitles = c2.parent.children.map((c) => c.title);
  assert.ok(sibTitles.includes(promoted.title), "上升节点应成为中心父级的新子节点: " + sibTitles.join("/"));
  const at = c2.parent.children.indexOf(c2);
  assert.strictEqual(c2.parent.children[at + 1].title, promoted.title, "应紧跟中心之后（下一个兄弟）");
  // 中心自己的剩余子节点保持不变（被上升的那个除外）。
  assert.deepStrictEqual(
    c2.children.map((c) => c.title),
    center.children.map((c) => c.title).filter((t2) => t2 !== promoted.title)
  );
  // 上升节点的子树原样保留（按新位置定位：中心的下一个兄弟）。
  const p2 = c2.parent.children[at + 1];
  assert.ok(p2, "上升节点应仍可定位");
  assert.strictEqual(p2.title, promoted.title);
  assert.deepStrictEqual(
    p2.children.map((c) => c.title),
    promoted.children.map((c) => c.title),
    "上升节点的子级原样保留"
  );
  console.log("        中心=" + center.title + " / 上升=" + promoted.title + " / 新兄弟序=" + sibTitles.join("/"));
});

// Renamed to "gogo+九宫.md" on 2026-11-12; accept both names.
const NOTE2 = [
  path.join(__dirname, "..", "..", "0新建未分类", "gogo+九宫.md"),
  path.join(__dirname, "..", "..", "0新建未分类", "gogo九宫.md"),
].find((p) => fs.existsSync(p));
if (NOTE2) {
  t("引用块备注：真实笔记编辑保存后下级无序列表仍是子节点", () => {
    const raw = fs.readFileSync(NOTE2, "utf8");
    const o = parseOutline(raw, { fileTitle: "gogo九宫" });
    let hit = null;
    const walk = (n) => { if (hit) return; if (n.title === "大段非标为备注") { hit = n; return; } for (const c of n.children) walk(c); };
    walk(o.root);
    assert.ok(hit, "应解析出「大段非标为备注」");
    const next = updateNode(raw, hit, { title: hit.title, notes: hit.notes });
    const lines = next.split(/\r?\n/);
    const a = lines.findIndex((l) => /^\s*- 大段非标为备注(?:\s|$)/.test(l));
    const b = lines.findIndex((l, i) => i > a && /^\s*- 改调统一，实时显示(?:\s|$)/.test(l));
    assert.ok(a >= 0 && b > a, "应能定位问题段");
    const seg = lines.slice(a, b);
    assert.ok(!seg.some((l) => /^> /.test(l)), "编辑保存后不应再出现顶格引用块");
    assert.ok(seg.some((l) => /^\t> /.test(l)), "备注应保持 Tab 缩进");
    const o2 = parseOutline(next, { fileTitle: "gogo九宫" });
    let p2 = null;
    const walk2 = (n) => { if (p2) return; if (n.title === "大段非标为备注") { p2 = n; return; } for (const c of n.children) walk2(c); };
    walk2(o2.root);
    assert.deepStrictEqual(p2.children.map((c) => c.title), ["6级md标题", "序号、无序大纲"]);
    assert.ok(p2.notes.some((s) => s.includes("元会运世")));
    console.log("        真实笔记编辑保存：备注 " + p2.notes.length + " 行 / 子节点 " + p2.children.length + " 个");
  });
}

console.log("=== v1.3.1 中心格备注（真实笔记 + 实际设置）===");

t("真实笔记：showNotes=true 时中心格默认显示根节点备注", () => {
  const { host } = mk({ showNotes: true });
  const center = byClass(host, "enm-cell-center")[0];
  assert.ok(center, "应有中心格");
  const blocks = all(center).filter((e) => e.classes.has("enm-notes"));
  const preview = notePreview(outline.root, 120);
  assert.ok(preview, "真实笔记根节点应有备注");
  assert.strictEqual(blocks.length, 1, "中心格应渲染 1 个备注块");
  assert.strictEqual(blocks[0]._text, preview, "内容应与根节点备注预览一致");
  const toggle = all(center).find((e) => e.classes.has("enm-cell-toggle"));
  assert.strictEqual(toggle._text, "⌃", "默认展开时三角朝上");
  console.log("        中心备注预览 = " + preview.slice(0, 40) + "…");
});

t("真实笔记：showNotes=false 时中心格隐藏备注，点 ⌄ 后显示", () => {
  const { host } = mk({ showNotes: false });
  const center = byClass(host, "enm-cell-center")[0];
  assert.strictEqual(
    all(center).filter((e) => e.classes.has("enm-notes")).length,
    0
  );
  const toggle = all(center).find((e) => e.classes.has("enm-cell-toggle"));
  fire(toggle, "click", { preventDefault() {}, stopPropagation() {} });
  const center2 = byClass(host, "enm-cell-center")[0];
  assert.ok(
    all(center2).some((e) => e.classes.has("enm-notes")),
    "点中心 ⌄ 后应显示备注"
  );
});

console.log("=== " + pass + " passed ===");
