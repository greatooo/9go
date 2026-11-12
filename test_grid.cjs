/**
 * DOM-level regression for MandalaGrid (render / pagination / drill-down).
 * Uses a tiny fake DOM + an "obsidian" module stub. No Obsidian required.
 * Run: node test_grid.cjs
 */
const assert = require("assert");
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
    // classList-compatible view over `classes`, needed by LocateFlash.
    this.classList = {
      add: (...cs) => { for (const c of cs) this.classes.add(c); },
      remove: (...cs) => { for (const c of cs) this.classes.delete(c); },
      contains: (c) => this.classes.has(c),
    };
  }
  addClass(c) { this.classes.add(c); return this; }
  removeClass(...cs) { for (const c of cs) this.classes.delete(c); return this; }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 };
  }
  empty() { this.children = []; return this; }
  createDiv(o) { const e = new FakeEl("div", o); this.children.push(e); return e; }
  createSpan(o) { const e = new FakeEl("span", o); this.children.push(e); return e; }
  createEl(tag, o) { const e = new FakeEl(tag, o); this.children.push(e); return e; }
  appendChild(e) { this.children.push(e); return e; }
  setText(t) { this._text = String(t); return this; }
  getText() { return this._text; }
  setAttr(k, v) { this.attrs[k] = v; return this; }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
}

global.createDiv = (o) => new FakeEl("div", o);

// Controllable timers: single-click locate is deferred so a dblclick can
// cancel it. Tests flush manually instead of relying on real time.
let timerSeq = 0;
const pendingTimers = new Map();
global.window = {
  setTimeout: (fn, ms) => {
    const id = ++timerSeq;
    pendingTimers.set(id, { fn, ms: ms || 0 });
    return id;
  },
  clearTimeout: (id) => pendingTimers.delete(id),
};
function flushTimers() {
  const entries = Array.from(pendingTimers.values());
  pendingTimers.clear();
  for (const e of entries) e.fn();
}

// ---------------------------------------------------------------- obsidian stub
class Base { constructor(..._a) {} }
const obsidianStub = {
  App: Base,
  ItemView: Base,
  MarkdownView: Base,
  Menu: Base,
  Modal: Base,
  Notice: class { constructor(msg) { this.msg = msg; } },
  Plugin: Base,
  PluginSettingTab: Base,
  Setting: Base,
  TAbstractFile: Base,
  TFile: Base,
  WorkspaceLeaf: Base,
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") return obsidianStub;
  return origLoad.call(this, request, parent, isMain);
};

// ---------------------------------------------------------------- load bundles
const core = require(path.join(__dirname, ".core-test-bundle.cjs"));
const bundle = require(
  path.join(__dirname, "..", "..", ".obsidian", "plugins", "9go", "main.js")
);
Module._load = origLoad;

const { MandalaGrid, LocateFlash } = bundle;
const { parseOutline, SLOT_POS, buildSlots, childNumber } = core;

let pass = 0;
function t(name, fn) {
  try {
    fn();
    pass += 1;
    console.log("  PASS  " + name);
  } catch (e) {
    console.error("  FAIL  " + name + " -> " + (e && e.stack ? e.stack.split("\n")[0] : e));
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- helpers
function all(el, out) {
  out = out || [];
  out.push(el);
  for (const c of el.children) all(c, out);
  return out;
}
function byClass(root, cls) {
  return all(root).filter((e) => e.classes.has(cls));
}
function links(root, textPart) {
  return all(root).filter(
    (e) => e.tag === "a" && String(e._text).includes(textPart)
  );
}
function fire(el, type, evt) {
  assert.ok(el, "element missing");
  const fns = el.listeners[type] || [];
  assert.ok(fns.length, "no " + type + " listener");
  for (const fn of fns) fn(evt || {});
}
const clickEvt = { preventDefault() {}, stopPropagation() {} };
const dblEvt = { target: { closest: () => null }, preventDefault() {}, stopPropagation() {} };

function makeGrid(nChildren, opts) {
  const lines = [];
  for (let i = 1; i <= nChildren; i += 1) {
    lines.push("# 节点" + i);
    lines.push("");
  }
  const outline = parseOutline(lines.join("\n"), { fileTitle: "根笔记" });
  const host = new FakeEl("div");
  const grid = new MandalaGrid(
    host,
    outline,
    Object.assign(
      { showNotes: false, noteMaxChars: 120, autoCollapseSingleRoot: false },
      opts || {}
    )
  );
  grid.render();
  return { host, grid, outline };
}

function cellAt(host, row, col) {
  return byClass(host, "enm-cell").find(
    (e) => e.style.gridRow === String(row + 1) && e.style.gridColumn === String(col + 1)
  );
}

console.log("=== 网格渲染 ===");

t("3x3 共 9 个格子（1 中心 + 8 环绕）", () => {
  const { host } = makeGrid(8);
  assert.strictEqual(byClass(host, "enm-cell").length, 9);
  assert.strictEqual(byClass(host, "enm-cell-center").length, 1);
});

t("中心格位于第 2 行第 2 列，标题 = 笔记标题", () => {
  const { host } = makeGrid(8);
  const c = cellAt(host, 1, 1);
  assert.ok(c);
  assert.ok(all(c).some((e) => e._text === "根笔记"));
  assert.ok(all(c).some((e) => e._text === "CENTER"));
});

t("8 个子节点按顺时针落位：第1个在正上方，第8个在左上角", () => {
  const { host } = makeGrid(8);
  const top = cellAt(host, 0, 1);
  const topLeft = cellAt(host, 0, 0);
  assert.ok(all(top).some((e) => e._text === "节点1"), "正上方应为节点1");
  assert.ok(all(topLeft).some((e) => e._text === "节点8"), "左上角应为节点8");
  assert.ok(all(cellAt(host, 0, 2)).some((e) => e._text === "节点2"));
  assert.ok(all(cellAt(host, 2, 1)).some((e) => e._text === "节点5"));
  assert.ok(all(cellAt(host, 1, 0)).some((e) => e._text === "节点7"));
  assert.deepStrictEqual(SLOT_POS[7], [0, 0]);
});

t("默认每个格位左上角显示层级编号 1–8，坐标标签隐藏", () => {
  const { host } = makeGrid(8);
  for (let slot = 0; slot < SLOT_POS.length; slot += 1) {
    const [r, c] = SLOT_POS[slot];
    const cell = cellAt(host, r, c);
    const num = all(cell).find((e) => e.classes.has("enm-cell-index"));
    assert.ok(num && num._text === String(slot + 1), `编号缺失 @${r},${c}`);
  }
  const labels = byClass(host, "enm-cell-label");
  assert.strictEqual(labels.length, 1, "只剩中心格的 CENTER 标签");
  assert.strictEqual(labels[0]._text, "CENTER");
});

t("showSlotCoords=true 时右上角显示 1.1–1.8 坐标", () => {
  const { host } = makeGrid(8, { showSlotCoords: true });
  for (const [r, c] of SLOT_POS) {
    const cell = cellAt(host, r, c);
    const label = all(cell).find((e) => e.classes.has("enm-cell-label"));
    assert.ok(label && /^1\.[1-8]$/.test(label._text), `坐标缺失 @${r},${c}`);
  }
  assert.strictEqual(byClass(host, "enm-cell-label").length, 9);
});

t("少于 8 个节点：空格保留，第 8 格仍常驻「更多子节点 (9–16)」", () => {
  const { host } = makeGrid(3);
  assert.strictEqual(byClass(host, "enm-cell").length, 9);
  assert.strictEqual(byClass(host, "enm-cell-empty").length, 5);
  const more = links(host, "更多子节点");
  assert.strictEqual(more.length, 1, "第 8 格无论有无内容都显示更多链接");
  assert.ok(more[0]._text.includes("9–16"));
  assert.strictEqual(links(host, "返回").length, 0);
});

console.log("=== 分页（>8 / >16）===");

t("12 个子节点：第1页左上角显示「更多子节点 (9–12)」", () => {
  const { host } = makeGrid(12);
  const tl = cellAt(host, 0, 0);
  assert.ok(all(tl).some((e) => e._text === "节点8"), "第8个节点仍要显示");
  const more = links(host, "更多子节点");
  assert.strictEqual(more.length, 1);
  assert.ok(more[0]._text.includes("9–12"));
});

t("点「更多子节点」→ 第2页：节点9 回到正上方，左上角同时显示「返回」", () => {
  const { host } = makeGrid(12);
  fire(links(host, "更多子节点")[0], "click", clickEvt);
  assert.ok(all(cellAt(host, 0, 1)).some((e) => e._text === "节点9"));
  const back = links(host, "返回");
  assert.ok(back.length >= 1, "第2页应有返回链接");
  assert.ok(byClass(host, "enm-pageinfo").some((e) => e._text === "2 / 2"));
});

t("点「返回」→ 回到第1页", () => {
  const { host } = makeGrid(12);
  fire(links(host, "更多子节点")[0], "click", clickEvt);
  fire(links(host, "← 返回")[0], "click", clickEvt);
  assert.ok(all(cellAt(host, 0, 1)).some((e) => e._text === "节点1"));
  assert.ok(byClass(host, "enm-pageinfo").some((e) => e._text === "1 / 2"));
});

t("20 个子节点：3 页，第2页左上角同时有「更多子节点」和「返回」", () => {
  const { host } = makeGrid(20);
  assert.ok(byClass(host, "enm-pageinfo").some((e) => e._text === "1 / 3"));
  fire(links(host, "更多子节点")[0], "click", clickEvt);
  assert.ok(byClass(host, "enm-pageinfo").some((e) => e._text === "2 / 3"));
  assert.ok(links(host, "更多子节点")[0]._text.includes("17–20"));
  assert.strictEqual(links(host, "← 返回").length, 1);
  fire(links(host, "更多子节点")[0], "click", clickEvt);
  assert.ok(byClass(host, "enm-pageinfo").some((e) => e._text === "3 / 3"));
  assert.ok(all(cellAt(host, 0, 1)).some((e) => e._text === "节点17"));
  const lastMore = links(host, "更多子节点");
  assert.strictEqual(lastMore.length, 1, "末页第 8 格仍常驻更多链接");
  assert.ok(lastMore[0]._text.includes("25–32"), "指向下一批 21–28 之后的虚拟批");
});

console.log("=== v1.3.1 常驻「更多子节点」→ 虚拟编辑页 ===");

t("3 个子节点：点「更多子节点 (9–16)」→ 空编辑页（8 个空格 + 返回）", () => {
  const { host } = makeGrid(3);
  fire(links(host, "更多子节点")[0], "click", clickEvt);
  assert.strictEqual(byClass(host, "enm-cell-empty").length, 8, "整页都是可新建空格");
  assert.strictEqual(byClass(host, "enm-cell-filled").length, 0);
  assert.ok(links(host, "← 返回").length >= 1, "空编辑页应有返回链接");
  assert.ok(byClass(host, "enm-pageinfo").some((e) => e._text === "2 / 2"));
  assert.ok(links(host, "更多子节点")[0]._text.includes("17–24"), "空页第 8 格指向下一批");
});

t("空编辑页：点「返回」→ 回到第 1 页", () => {
  const { host } = makeGrid(3);
  fire(links(host, "更多子节点")[0], "click", clickEvt);
  fire(links(host, "← 返回")[0], "click", clickEvt);
  assert.ok(all(cellAt(host, 0, 1)).some((e) => e._text === "节点1"), "节点1 应回到正上方");
  assert.strictEqual(byClass(host, "enm-cell-empty").length, 5, "恢复 5 个空格");
});

t("空编辑页：双击空格 → onAddNode 收到对应 slot（新节点仍按顺序追加）", () => {
  let got = -1;
  const { host } = makeGrid(3, { onAddNode: (s) => { got = s; } });
  fire(links(host, "更多子节点")[0], "click", clickEvt);
  fire(cellAt(host, 0, 1), "dblclick", dblEvt);
  assert.strictEqual(got, 0);
});

console.log("=== 双击下钻 / 返回上级 ===");

function nestedGrid(opts) {
  const text = [
    "# 一级A", "", "## 二级A1", "", "## 二级A2", "",
    "# 一级B", "", "## 二级B1", "",
  ].join("\n");
  const outline = parseOutline(text, { fileTitle: "我的笔记" });
  const host = new FakeEl("div");
  const grid = new MandalaGrid(
    host,
    outline,
    Object.assign(
      { showNotes: false, noteMaxChars: 120, autoCollapseSingleRoot: false },
      opts || {}
    )
  );
  grid.render();
  return { host, grid, outline };
}

t("首屏中心 = 笔记标题，环绕 = 两个一级标题", () => {
  const { host } = nestedGrid();
  const c = cellAt(host, 1, 1);
  assert.ok(all(c).some((e) => e._text === "我的笔记"));
  assert.ok(all(cellAt(host, 0, 1)).some((e) => e._text === "一级A"));
  assert.ok(all(cellAt(host, 0, 2)).some((e) => e._text === "一级B"));
  const upBtn = byClass(host, "enm-btn").find((e) => String(e._text).includes("返回上级"));
  assert.ok(upBtn, "工具栏应有返回上级按钮");
  assert.strictEqual(upBtn.disabled, true, "根层返回上级应禁用");
});

t("点「下级 N」（一级A）→ 以它为中心，环绕显示 ## 二级A1/A2", () => {
  const { host } = nestedGrid();
  const top = cellAt(host, 0, 1);
  const cc = all(top).find((e) => e.classes.has("enm-childcount-drill"));
  fire(cc, "click", clickEvt);
  const c = cellAt(host, 1, 1);
  assert.ok(all(c).some((e) => e._text === "一级A"), "中心应变为一级A");
  assert.ok(all(cellAt(host, 0, 1)).some((e) => e._text === "二级A1"));
  assert.ok(all(cellAt(host, 0, 2)).some((e) => e._text === "二级A2"));
  assert.ok(byClass(host, "enm-crumb").some((e) => e._text.includes("我的笔记")));
  assert.ok(byClass(host, "enm-crumb").some((e) => e._text.includes("一级A")));
});

t("下钻后中心格出现「返回上级」链接，点击回到根九宫格", () => {
  const { host } = nestedGrid();
  const cc = all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-childcount-drill"));
  fire(cc, "click", clickEvt);
  assert.strictEqual(links(host, "← 返回上级").length, 1);
  fire(links(host, "← 返回上级")[0], "click", clickEvt);
  assert.ok(all(cellAt(host, 1, 1)).some((e) => e._text === "我的笔记"));
  assert.strictEqual(links(host, "← 返回上级").length, 0);
});

t("无下级节点双击标题 → 以该叶节点为中心（空九宫可继续加子节点）", () => {
  const { host } = makeGrid(3);
  const title = all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-cell-title"));
  fire(title, "dblclick", dblEvt);
  assert.ok(all(cellAt(host, 1, 1)).some((e) => e._text === "节点1"), "中心应变叶节点");
  assert.ok(all(cellAt(host, 1, 1)).some((e) => e._text === "（无下级节点）"));
});

console.log("=== 备注 ===");

t("默认隐藏备注；点 ⌄ 后该格显示备注", () => {
  const text = ["# 甲", "这是甲的备注内容", "", "# 乙", ""].join("\n");
  const outline = parseOutline(text, { fileTitle: "x" });
  const host = new FakeEl("div");
  const grid = new MandalaGrid(host, outline, {
    showNotes: false, noteMaxChars: 120, autoCollapseSingleRoot: false,
  });
  grid.render();
  assert.strictEqual(byClass(host, "enm-notes").length, 0);
  const toggle = all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-cell-toggle"));
  fire(toggle, "click", clickEvt);
  assert.ok(byClass(host, "enm-notes").some((e) => e._text.includes("这是甲的备注内容")));
});

t("showNotes=true 时全部格子显示备注", () => {
  const text = ["# 甲", "备注甲", "", "# 乙", "备注乙", ""].join("\n");
  const outline = parseOutline(text, { fileTitle: "x" });
  const host = new FakeEl("div");
  const grid = new MandalaGrid(host, outline, {
    showNotes: true, noteMaxChars: 120, autoCollapseSingleRoot: false,
  });
  grid.render();
  assert.ok(byClass(host, "enm-notes").length >= 2);
});

// ---------------------------------------------------------------- v1.3.1
// The centre cell used to ignore the global "show notes" setting entirely:
// only its own toggle could reveal notes. These cases lock in the fix.
function centerNoteGrid(showNotes) {
  const text = [
    "# 中心标题",
    "这是中心的备注内容",
    "",
    "## 子1",
    "子1的备注内容",
    "",
    "### 孙1",
    "孙1的备注内容",
    "",
    "## 子2",
    "",
  ].join("\n");
  const outline = parseOutline(text, { fileTitle: "x" });
  const host = new FakeEl("div");
  const grid = new MandalaGrid(host, outline, {
    showNotes,
    noteMaxChars: 120,
    autoCollapseSingleRoot: true, // collapse the single H1 so it is the centre
  });
  grid.render();
  return { host, grid };
}
function centerNotes(host) {
  return all(cellAt(host, 1, 1))
    .filter((e) => e.classes.has("enm-notes"))
    .map((e) => e._text)
    .join("\n");
}
function centerToggle(host) {
  return all(cellAt(host, 1, 1)).find((e) => e.classes.has("enm-cell-toggle"));
}

console.log("=== v1.3.1 中心格备注 ===");

t("中心格：showNotes=true 时默认显示备注（v1.3.1 修复）", () => {
  const { host } = centerNoteGrid(true);
  assert.ok(
    centerNotes(host).includes("这是中心的备注内容"),
    "中心格应默认显示自己的备注"
  );
  assert.strictEqual(centerToggle(host)._text, "⌃", "默认展开时三角朝上");
});

t("中心格：showNotes=false 时默认隐藏，点中心 ⌄ 可单独展开", () => {
  const { host } = centerNoteGrid(false);
  assert.strictEqual(centerNotes(host), "", "中心格默认不显示备注");
  assert.strictEqual(centerToggle(host)._text, "⌄");
  fire(centerToggle(host), "click", clickEvt);
  assert.ok(centerNotes(host).includes("这是中心的备注内容"));
  assert.strictEqual(centerToggle(host)._text, "⌃");
});

t("中心格：手动 toggle 可覆盖 showNotes=true，来回切换稳定", () => {
  const { host } = centerNoteGrid(true);
  fire(centerToggle(host), "click", clickEvt);
  assert.strictEqual(centerNotes(host), "", "手动收起后中心不显示备注");
  assert.ok(byClass(host, "enm-notes").length >= 1, "环绕格备注不受影响");
  assert.strictEqual(centerToggle(host)._text, "⌄");
  fire(centerToggle(host), "click", clickEvt);
  assert.ok(centerNotes(host).includes("这是中心的备注内容"), "再点恢复显示");
  assert.strictEqual(centerToggle(host)._text, "⌃");
});

t("中心格：下钻后清除手动覆盖，新中心重新跟随设置", () => {
  const { host } = centerNoteGrid(true);
  fire(centerToggle(host), "click", clickEvt);
  assert.strictEqual(centerNotes(host), "", "先手动收起中心");
  const cc = all(cellAt(host, 0, 1)).find((e) =>
    e.classes.has("enm-childcount-drill")
  );
  assert.ok(cc, "子1 应有下级，可走「下级 N」下钻");
  fire(cc, "click", clickEvt);
  assert.ok(
    all(cellAt(host, 1, 1)).some((e) => e._text === "子1"),
    "中心应变为子1"
  );
  assert.ok(
    all(cellAt(host, 1, 1)).some(
      (e) => e.classes.has("enm-notes") && e._text.includes("子1的备注内容")
    ),
    "新中心应重新按设置显示备注"
  );
});

console.log("=== v1.1.0 双击空格新建 ===");

const evtOnButton = {
  target: { closest: () => ({}) },
  preventDefault() {},
  stopPropagation() {},
};

t("传入 onAddNode 时空格显示「+ 双击添加」，未传时不显示", () => {
  const a = makeGrid(3, { onAddNode: () => {} });
  assert.strictEqual(byClass(a.host, "enm-cell-addable").length, 5);
  assert.strictEqual(byClass(a.host, "enm-add-hint").length, 5);
  const b = makeGrid(3);
  assert.strictEqual(byClass(b.host, "enm-cell-addable").length, 0);
  assert.strictEqual(byClass(b.host, "enm-add-hint").length, 0);
});

t("双击空格触发 onAddNode 并回传正确 slot", () => {
  let got = -1;
  const { host } = makeGrid(3, { onAddNode: (s) => { got = s; } });
  // 3 个节点占 slot 0/1/2，slot 3 落在 (2,2)
  const empty = cellAt(host, 2, 2);
  assert.ok(empty.classes.has("enm-cell-addable"));
  fire(empty, "dblclick", dblEvt);
  assert.strictEqual(got, 3);
});

t("双击空格点在链接/按钮上不触发新建", () => {
  let n = 0;
  const { host } = makeGrid(3, { onAddNode: () => { n += 1; } });
  fire(cellAt(host, 2, 2), "dblclick", evtOnButton);
  assert.strictEqual(n, 0);
});

t("已填充格不显示新建提示", () => {
  const { host } = makeGrid(3, { onAddNode: () => {} });
  assert.ok(!cellAt(host, 0, 1).classes.has("enm-cell-addable"));
});

console.log("=== v1.1.0 单击定位 / 双击下钻 ===");

t("单击子格：延时后调用 onLocate(node)，不带 forceOpen", () => {
  const calls = [];
  const { host } = makeGrid(3, {
    singleClickLocate: true,
    onLocate: (n, f) => calls.push([n.title, f]),
  });
  fire(cellAt(host, 0, 1), "click", clickEvt);
  assert.strictEqual(calls.length, 0, "单击应先延时，不与双击抢");
  flushTimers();
  assert.deepStrictEqual(calls, [["节点1", undefined]]);
});

t("点「下级 N」：取消待执行的定位，只做下钻", () => {
  const calls = [];
  const text = ["# 一级A", "", "## 二级A1", "", "# 一级B", ""].join("\n");
  const outline = parseOutline(text, { fileTitle: "我的笔记" });
  const host = new FakeEl("div");
  const grid = new MandalaGrid(host, outline, {
    showNotes: false, noteMaxChars: 120, autoCollapseSingleRoot: false,
    singleClickLocate: true, onLocate: (n) => calls.push(n.title),
  });
  grid.render();
  const cc = all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-childcount-drill"));
  fire(cc, "click", clickEvt);
  flushTimers();
  assert.deepStrictEqual(calls, [], "下钻后不应再定位");
  assert.ok(all(cellAt(host, 1, 1)).some((e) => e._text === "一级A"), "应已下钻");
});

t("有下级的节点双击标题 → 不下钻、不编辑、不定位（下级统一走「下级 N」）", () => {
  const calls = [];
  const text = ["# 一级A", "", "## 二级A1", "", "# 一级B", ""].join("\n");
  const outline = parseOutline(text, { fileTitle: "我的笔记" });
  const host = new FakeEl("div");
  const grid = new MandalaGrid(host, outline, {
    showNotes: false, noteMaxChars: 120, autoCollapseSingleRoot: false,
    singleClickLocate: true,
    onEditNode: (n) => calls.push("EDIT:" + n.title),
    onLocate: (n) => calls.push("LOCATE:" + n.title),
  });
  grid.render();
  const title = all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-cell-title"));
  fire(title, "dblclick", dblEvt);
  flushTimers();
  assert.deepStrictEqual(calls, [], "不应触发任何动作");
  assert.ok(all(cellAt(host, 1, 1)).some((e) => e._text === "我的笔记"), "不应下钻");
});

t("单击中心格：立即定位中心节点", () => {
  const calls = [];
  const { host } = makeGrid(3, {
    singleClickLocate: true, onLocate: (n) => calls.push(n.title),
  });
  fire(cellAt(host, 1, 1), "click", clickEvt);
  assert.deepStrictEqual(calls, ["根笔记"]);
});

t("点在按钮/链接上不触发定位", () => {
  const calls = [];
  const { host } = makeGrid(3, {
    singleClickLocate: true, onLocate: (n) => calls.push(n.title),
  });
  fire(cellAt(host, 0, 1), "click", evtOnButton);
  fire(cellAt(host, 1, 1), "click", evtOnButton);
  flushTimers();
  assert.deepStrictEqual(calls, []);
});

t("↗ 按钮调用 onLocate 且 forceOpen=true", () => {
  const calls = [];
  const { host } = makeGrid(3, { onLocate: (n, f) => calls.push([n.title, f]) });
  const btn = all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-cell-locate"));
  fire(btn, "click", clickEvt);
  assert.deepStrictEqual(calls, [["节点1", true]]);
});

t("singleClickLocate=false 时不绑定单击定位", () => {
  const calls = [];
  const { host } = makeGrid(3, {
    singleClickLocate: false, onLocate: (n) => calls.push(n.title),
  });
  assert.strictEqual((cellAt(host, 0, 1).listeners.click || []).length, 0);
  assert.strictEqual((cellAt(host, 1, 1).listeners.click || []).length, 0);
  flushTimers();
  assert.deepStrictEqual(calls, []);
});

console.log("=== v1.1.0 导航状态保持 ===");

t("下钻后 getStackTitles 返回路径，applyNavigation 可恢复", () => {
  const { host, grid, outline } = nestedGrid();
  const cc = all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-childcount-drill"));
  fire(cc, "click", clickEvt);
  assert.deepStrictEqual(grid.getStackTitles(), ["我的笔记", "一级A"]);
  const host2 = new FakeEl("div");
  const g2 = new MandalaGrid(host2, outline, {
    showNotes: false, noteMaxChars: 120, autoCollapseSingleRoot: false,
  });
  g2.applyNavigation(grid.getStackTitles(), grid.getPage());
  g2.render();
  assert.ok(all(cellAt(host2, 1, 1)).some((e) => e._text === "一级A"), "重绘后仍停在下一级");
  assert.ok(all(cellAt(host2, 0, 1)).some((e) => e._text === "二级A1"));
});

t("翻页后 applyNavigation 恢复页码（未下钻也生效）", () => {
  const { host, grid, outline } = makeGrid(12);
  fire(links(host, "更多子节点")[0], "click", clickEvt);
  assert.strictEqual(grid.getPage(), 1);
  assert.deepStrictEqual(grid.getStackTitles(), ["根笔记"]);
  const host2 = new FakeEl("div");
  const g2 = new MandalaGrid(host2, outline, {
    showNotes: false, noteMaxChars: 120, autoCollapseSingleRoot: false,
  });
  g2.applyNavigation(grid.getStackTitles(), grid.getPage());
  g2.render();
  assert.ok(byClass(host2, "enm-pageinfo").some((e) => e._text === "2 / 2"));
});

console.log("=== v1.2.0 方位 / 方向 / 编号 ===");

t("自定义首节点方位：左上起顺时针，节点1 落在左上角", () => {
  const { host } = makeGrid(8, { slots: buildSlots("top-left", "cw") });
  assert.ok(all(cellAt(host, 0, 0)).some((e) => e._text === "节点1"));
  const num = all(cellAt(host, 0, 0)).find((e) => e.classes.has("enm-cell-index"));
  assert.strictEqual(num._text, "1");
  assert.ok(all(cellAt(host, 0, 1)).some((e) => e._text === "节点2"));
});

t("逆时针：节点1 在正上方，节点2 在左上角", () => {
  const { host } = makeGrid(8, { slots: buildSlots("top", "ccw") });
  assert.ok(all(cellAt(host, 0, 1)).some((e) => e._text === "节点1"));
  assert.ok(all(cellAt(host, 0, 0)).some((e) => e._text === "节点2"));
});

t("下钻后子格编号变 1.1 / 1.2，中心格显示自身编号 1", () => {
  const { host } = nestedGrid();
  const cc = all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-childcount-drill"));
  fire(cc, "click", clickEvt);
  const cNum = all(cellAt(host, 1, 1)).find((e) => e.classes.has("enm-cell-index"));
  assert.strictEqual(cNum._text, "1");
  assert.strictEqual(
    all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-cell-index"))._text,
    "1.1"
  );
  assert.strictEqual(
    all(cellAt(host, 0, 2)).find((e) => e.classes.has("enm-cell-index"))._text,
    "1.2"
  );
});

t("第 4 层编号压缩为 1...1.1", () => {
  const text = ["# 一级1", "", "## 二级1", "", "### 三级1", "", "#### 四级1", ""].join("\n");
  const outline = parseOutline(text, { fileTitle: "x" });
  const host = new FakeEl("div");
  const grid = new MandalaGrid(host, outline, {
    showNotes: false, noteMaxChars: 120, autoCollapseSingleRoot: false,
  });
  grid.render();
  for (let i = 0; i < 3; i += 1) {
    const cc = all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-childcount-drill"));
    fire(cc, "click", clickEvt);
  }
  const num = all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-cell-index"));
  assert.strictEqual(num._text, "1...1.1");
});

t("翻页后编号连续（第 2 页 9–12，不重置）", () => {
  const { host } = makeGrid(12);
  fire(links(host, "更多子节点")[0], "click", clickEvt);
  const nums = [];
  for (let slot = 0; slot < 4; slot += 1) {
    const [r, c] = SLOT_POS[slot];
    const num = all(cellAt(host, r, c)).find((e) => e.classes.has("enm-cell-index"));
    nums.push(num && num._text);
  }
  assert.deepStrictEqual(nums, ["9", "10", "11", "12"]);
});

console.log("=== v1.2.0 拖动重排事件 ===");

const dragStartEvt = { dataTransfer: { effectAllowed: "", setData() {} } };
const dragOverEvt = (x, y) => ({
  preventDefault() {}, clientX: x, clientY: y, dataTransfer: {},
});
const dropEvt = (x, y) => ({
  preventDefault() {}, stopPropagation() {}, clientX: x, clientY: y,
});

t("拖到目标右半区 → onReorder(0, 1, true) 且插入线高亮", () => {
  const calls = [];
  const { host } = makeGrid(4, { onReorder: (f, t, a) => calls.push([f, t, a]) });
  const src = cellAt(host, 0, 1);
  const dst = cellAt(host, 0, 2);
  fire(src, "dragstart", dragStartEvt);
  fire(dst, "dragover", dragOverEvt(80, 50));
  assert.ok(dst.classes.has("enm-drop-after"));
  assert.ok(dst.classes.has("enm-drop-target"));
  fire(dst, "drop", dropEvt(80, 50));
  assert.deepStrictEqual(calls, [[0, 1, true]]);
  assert.ok(!dst.classes.has("enm-drop-target"), "放下后应清除高亮");
});

t("拖到目标左半区 → onReorder(0, 1, false)", () => {
  const calls = [];
  const { host } = makeGrid(4, { onReorder: (f, t, a) => calls.push([f, t, a]) });
  fire(cellAt(host, 0, 1), "dragstart", dragStartEvt);
  const dst = cellAt(host, 0, 2);
  fire(dst, "dragover", dragOverEvt(20, 50));
  assert.ok(dst.classes.has("enm-drop-before"));
  fire(dst, "drop", dropEvt(20, 50));
  assert.deepStrictEqual(calls, [[0, 1, false]]);
});

t("空格也可作为放置目标", () => {
  const calls = [];
  const { host } = makeGrid(3, { onReorder: (f, t, a) => calls.push([f, t, a]) });
  fire(cellAt(host, 0, 1), "dragstart", dragStartEvt);
  fire(cellAt(host, 2, 2), "drop", dropEvt(50, 50));
  assert.deepStrictEqual(calls, [[0, 3, false]]);
});

t("未传 onReorder 或关闭开关时不绑定拖拽", () => {
  const a = makeGrid(4);
  assert.strictEqual((cellAt(a.host, 0, 1).listeners.dragstart || []).length, 0);
  const b = makeGrid(4, { onReorder: () => {}, enableDragReorder: false });
  assert.strictEqual((cellAt(b.host, 0, 1).listeners.dragstart || []).length, 0);
  assert.strictEqual((cellAt(b.host, 0, 1).listeners.drop || []).length, 0);
});

console.log("=== v1.3.1 拖到中心格 = 上升一级 ===");

t("拖动子节点到中心格 → onPromoteNode(from)，中心格整格高亮", () => {
  const calls = [];
  const { host } = nestedGrid({
    onReorder: () => {},
    onPromoteNode: (f) => calls.push(f),
  });
  const cc = all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-childcount-drill"));
  fire(cc, "click", clickEvt); // 下钻到一级A（有父级）
  const center = cellAt(host, 1, 1);
  assert.ok(center.classes.has("enm-center-droptarget"), "中心格应有放置目标样式");
  fire(cellAt(host, 0, 1), "dragstart", dragStartEvt);
  fire(center, "dragover", dragOverEvt(50, 50));
  assert.ok(center.classes.has("enm-drop-target"), "dragover 应整格高亮");
  assert.ok(!center.classes.has("enm-drop-after"), "中心格无插入线语义");
  fire(center, "drop", dropEvt(50, 50));
  assert.deepStrictEqual(calls, [0], "应把拖源全局索引交给 onPromoteNode");
  assert.ok(!center.classes.has("enm-drop-target"), "放下后清除高亮");
});

t("根中心（无父级）不绑定中心格放置目标", () => {
  const { host } = nestedGrid({ onReorder: () => {}, onPromoteNode: () => {} });
  const center = cellAt(host, 1, 1);
  assert.ok(!center.classes.has("enm-center-droptarget"));
  assert.strictEqual((center.listeners.drop || []).length, 0);
});

console.log("=== 交互分工二轮（2026-11-10）：叶双击下钻 / 有下级走下级N / 空白双击编辑 ===");

t("有下级的节点双击标题 → 不下钻、不编辑、不定位", () => {
  const calls = [];
  const { host } = nestedGrid({
    singleClickLocate: true,
    onEditNode: (n) => calls.push("EDIT:" + n.title),
    onLocate: (n) => calls.push("LOCATE:" + n.title),
  });
  const title = all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-cell-title"));
  fire(title, "dblclick", dblEvt);
  flushTimers();
  assert.deepStrictEqual(calls, []);
  assert.ok(all(cellAt(host, 1, 1)).some((e) => e._text === "我的笔记"), "不应下钻");
});

t("无下级的节点双击标题 → 下钻到该叶节点，不触发编辑", () => {
  const calls = [];
  const { host } = makeGrid(3, {
    singleClickLocate: true,
    onEditNode: (n) => calls.push("EDIT:" + n.title),
    onLocate: (n) => calls.push("LOCATE:" + n.title),
  });
  const title = all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-cell-title"));
  fire(title, "dblclick", dblEvt);
  flushTimers();
  assert.deepStrictEqual(calls, []);
  assert.ok(all(cellAt(host, 1, 1)).some((e) => e._text === "节点1"), "应已下钻到叶节点");
});

t("双击节点空白处 → 触发编辑，不下钻、不定位", () => {
  const calls = [];
  const { host } = nestedGrid({
    singleClickLocate: true,
    onEditNode: (n) => calls.push("EDIT:" + n.title),
    onLocate: (n) => calls.push("LOCATE:" + n.title),
  });
  fire(cellAt(host, 0, 1), "dblclick", dblEvt);
  flushTimers();
  assert.deepStrictEqual(calls, ["EDIT:一级A"]);
  assert.ok(all(cellAt(host, 1, 1)).some((e) => e._text === "我的笔记"), "不应下钻");
});

t("单击节点空白处 → 延时后仍定位（保留旧行为）", () => {
  const calls = [];
  const { host } = makeGrid(3, {
    singleClickLocate: true,
    onLocate: (n, f) => calls.push([n.title, f]),
  });
  fire(cellAt(host, 0, 1), "click", clickEvt);
  assert.strictEqual(calls.length, 0, "单击应先延时");
  flushTimers();
  assert.deepStrictEqual(calls, [["节点1", undefined]]);
});

t("右下 ✎ 保留可编辑；⤵ 图标已移除", () => {
  const calls = [];
  const { host } = nestedGrid({ onEditNode: (n) => calls.push(n.title) });
  assert.strictEqual(byClass(host, "enm-cell-drill").length, 0, "⤵ 应不再渲染");
  const edit = all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-cell-edit"));
  assert.ok(edit, "✎ 应保留");
  fire(edit, "click", clickEvt);
  assert.deepStrictEqual(calls, ["一级A"]);
});

t("左下「下级 N」单击 → 下钻，并带可点标记", () => {
  const { host, grid } = nestedGrid();
  const cc = all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-childcount-drill"));
  assert.ok(cc, "有下级的节点应显示可点的「下级 N」");
  assert.ok(String(cc._text).startsWith("下级 "));
  fire(cc, "click", clickEvt);
  assert.ok(all(cellAt(host, 1, 1)).some((e) => e._text === "一级A"));
  assert.deepStrictEqual(grid.getStackTitles(), ["我的笔记", "一级A"]);
});

t("双击「下级 N」只下钻一次（detail>1 的第二次 click 被忽略）", () => {
  const { host, grid } = nestedGrid({ onEditNode: () => {} });
  const cc = all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-childcount-drill"));
  fire(cc, "click", clickEvt);
  fire(cc, "click", { preventDefault() {}, stopPropagation() {}, detail: 2 });
  assert.deepStrictEqual(grid.getStackTitles(), ["我的笔记", "一级A"], "不应重复入栈");
});

t("dblclick 源自标题/下级N 区域时不触发编辑（区域过滤）", () => {
  const calls = [];
  const { host } = nestedGrid({ onEditNode: (n) => calls.push(n.title) });
  const cell = cellAt(host, 0, 1);
  const zoneEvt = (needle) => ({
    target: { closest: (s) => (String(s).includes(needle) ? {} : null) },
    preventDefault() {},
    stopPropagation() {},
  });
  fire(cell, "dblclick", zoneEvt("enm-cell-title"));
  fire(cell, "dblclick", zoneEvt("enm-childcount"));
  assert.deepStrictEqual(calls, []);
});

t("下钻后中心格 ✎ 可编辑，双击中心标题/空白均可编辑；根中心不绑定编辑", () => {
  const calls = [];
  const root = makeGrid(3, { onEditNode: (n) => calls.push(n.title) });
  const rootTitle = all(cellAt(root.host, 1, 1)).find((e) => e.classes.has("enm-cell-title"));
  assert.strictEqual((rootTitle.listeners.dblclick || []).length, 0);
  assert.strictEqual(byClass(root.host, "enm-center-edit").length, 0);

  const { host } = nestedGrid({ onEditNode: (n) => calls.push(n.title) });
  const cc = all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-childcount-drill"));
  fire(cc, "click", clickEvt);
  assert.strictEqual(byClass(host, "enm-center-edit").length, 1);
  const cTitle = all(cellAt(host, 1, 1)).find((e) => e.classes.has("enm-cell-title"));
  fire(cTitle, "dblclick", dblEvt);
  fire(cellAt(host, 1, 1), "dblclick", dblEvt);
  assert.deepStrictEqual(calls, ["一级A", "一级A"]);
});

t("未传 onEditNode（内嵌代码块）：无 ✎/⤵，点「下级 N」仍下钻", () => {
  const { host } = nestedGrid();
  assert.strictEqual(byClass(host, "enm-cell-edit").length, 0);
  assert.strictEqual(byClass(host, "enm-cell-drill").length, 0);
  const cc = all(cellAt(host, 0, 1)).find((e) => e.classes.has("enm-childcount-drill"));
  fire(cc, "click", clickEvt);
  assert.ok(all(cellAt(host, 1, 1)).some((e) => e._text === "一级A"));
});

console.log("=== v1.3.0 光标跟随 ===");

t("focusAtLine(self)：中心切到光标节点，显示跟随标记与焦点高亮", () => {
  const { host, grid, outline } = nestedGrid();
  const line = outline.root.children[0].children[0].line;
  assert.strictEqual(grid.focusAtLine(line, "self"), true);
  grid.render();
  assert.ok(all(cellAt(host, 1, 1)).some((e) => e._text === "二级A1"));
  assert.strictEqual(byClass(host, "enm-follow-badge").length, 1);
  assert.strictEqual(byClass(host, "enm-cell-focus").length, 1);
  assert.ok(cellAt(host, 1, 1).classes.has("enm-cell-focus"));
});

t("focusAtLine 同一节点内移动返回 false，跨节点才返回 true", () => {
  const { grid, outline } = nestedGrid();
  const a = outline.root.children[0];
  assert.strictEqual(grid.focusAtLine(a.line, "self"), true);
  assert.strictEqual(grid.focusAtLine(a.line + 1, "self"), false);
  assert.strictEqual(grid.focusAtLine(a.children[0].line, "self"), true);
  assert.strictEqual(grid.getFocusNodeLine(), a.children[0].line);
});

t("focusAtLine(parent)：叶子回退到父级、翻页并高亮该格", () => {
  const { host, grid, outline } = makeGrid(10);
  const leaf = outline.root.children[9];
  assert.strictEqual(grid.focusAtLine(leaf.line, "parent"), true);
  grid.render();
  assert.strictEqual(grid.getPage(), 1);
  assert.ok(byClass(host, "enm-pageinfo").some((e) => e._text === "2 / 2"));
  assert.ok(all(cellAt(host, 0, 2)).some((e) => e._text === "节点10"));
  const focus = byClass(host, "enm-cell-focus");
  assert.strictEqual(focus.length, 1);
  assert.ok(all(focus[0]).some((e) => e._text === "节点10"));
  assert.ok(!cellAt(host, 1, 1).classes.has("enm-cell-focus"));
});

t("focusAtLine(self) 叶子：严格以叶子为中心且中心格高亮", () => {
  const { host, grid, outline } = makeGrid(3);
  grid.focusAtLine(outline.root.children[1].line, "self");
  grid.render();
  assert.ok(all(cellAt(host, 1, 1)).some((e) => e._text === "节点2"));
  assert.ok(cellAt(host, 1, 1).classes.has("enm-cell-focus"));
  assert.ok(all(cellAt(host, 1, 1)).some((e) => e._text === "（无下级节点）"));
});

t("clearFocus 移除跟随标记与焦点高亮", () => {
  const { host, grid, outline } = makeGrid(3);
  grid.focusAtLine(outline.root.children[0].line, "parent");
  grid.render();
  assert.strictEqual(byClass(host, "enm-follow-badge").length, 1);
  grid.clearFocus();
  grid.render();
  assert.strictEqual(byClass(host, "enm-follow-badge").length, 0);
  assert.strictEqual(byClass(host, "enm-cell-focus").length, 0);
});

t("applyNavigation 第三参数 lines：标题改名后仍恢复到原下钻层级", () => {
  const text = ["---", "mandala: true", "---", "", "# 一级A", "", "## 二级A1", "", "# 一级B", ""].join("\n");
  const opts = { showNotes: false, noteMaxChars: 120, autoCollapseSingleRoot: false };
  const o = parseOutline(text, { fileTitle: "笔记" });
  const hostA = new FakeEl("div");
  const gA = new MandalaGrid(hostA, o, opts);
  gA.render();
  const cc = all(cellAt(hostA, 0, 1)).find((e) => e.classes.has("enm-childcount-drill"));
  fire(cc, "click", clickEvt);
  const titles = gA.getStackTitles();
  const lines = gA.getStackLines();
  assert.deepStrictEqual(titles, ["笔记", "一级A"]);
  assert.deepStrictEqual(lines, [0, 4]);

  const o2 = parseOutline(text.replace("# 一级A", "# 一级A改"), { fileTitle: "笔记" });
  const host2 = new FakeEl("div");
  const g2 = new MandalaGrid(host2, o2, opts);
  g2.applyNavigation(titles, 0, lines);
  g2.render();
  assert.ok(all(cellAt(host2, 1, 1)).some((e) => e._text === "一级A改"), "按行号应恢复");

  const host3 = new FakeEl("div");
  const g3 = new MandalaGrid(host3, o2, opts);
  g3.applyNavigation(titles, 0); // 仅标题：失配，回退到根
  g3.render();
  assert.ok(all(cellAt(host3, 1, 1)).some((e) => e._text === "笔记"));
});

// ---------------------------------------------------------------- LocateFlash
// Regression for "highlight flashes and disappears / 1400ms setting ignored".
// Root cause: a CSS animation attached to one .cm-line node dies as soon as
// CodeMirror rebuilds that node. Lifetime is now owned by a single JS timer.
function flashEnv() {
  const root = new FakeEl("div");
  const line = new FakeEl("div", { cls: "cm-line" });
  root.appendChild(line);
  return { root, line };
}
function timerMs() {
  return Array.from(pendingTimers.values()).map((e) => e.ms);
}
function flushMatching(ms) {
  const entries = Array.from(pendingTimers.entries()).filter(([, e]) => e.ms === ms);
  for (const [id, e] of entries) {
    pendingTimers.delete(id);
    e.fn();
  }
}

t("高亮：单一 deadline = 设置时长 1400ms，不再依赖 CSS 动画", () => {
  pendingTimers.clear();
  const { root, line } = flashEnv();
  const f = new LocateFlash();
  f.start(root, line, () => line, 1400);
  assert.ok(line.classes.has("enm-locate-flash"), "应立即高亮");
  assert.ok(timerMs().includes(1400), "应有一个 1400ms 的结束定时器");
  assert.ok(!timerMs().includes(1480), "不应残留旧的 duration+80 清理定时器");
  assert.strictEqual(timerMs().filter((m) => m === 1400).length, 1, "只应有一个 deadline");
  f.clear();
});

t("高亮：自定义时长 3000ms 直接决定 deadline（设置即时生效）", () => {
  pendingTimers.clear();
  const { root, line } = flashEnv();
  const f = new LocateFlash();
  f.start(root, line, () => line, 3000);
  assert.ok(timerMs().includes(3000));
  assert.ok(!timerMs().includes(1400), "不应再使用默认 1400ms");
  f.clear();
});

t("高亮：到点进入淡出，220ms 后彻底移除 class", () => {
  pendingTimers.clear();
  const { root, line } = flashEnv();
  const f = new LocateFlash();
  f.start(root, line, () => line, 1400);
  flushTimers();
  assert.ok(line.classes.has("enm-locate-flash-fade"), "到点应加淡出类");
  assert.ok(line.classes.has("enm-locate-flash"), "淡出期间仍保留基础类");
  assert.ok(timerMs().includes(220), "应有 220ms 淡出定时器");
  flushTimers();
  assert.ok(!line.classes.has("enm-locate-flash"), "class 应清除");
  assert.ok(!line.classes.has("enm-locate-flash-fade"));
  f.clear();
});

t("高亮：CM6 重建 .cm-line 后自动恢复，deadline 不重启", () => {
  pendingTimers.clear();
  const { root } = flashEnv();
  const oldLine = new FakeEl("div", { cls: "cm-line" });
  const newLine = new FakeEl("div", { cls: "cm-line" });
  let current = oldLine;
  const f = new LocateFlash();
  f.start(root, oldLine, () => current, 1400);
  assert.ok(oldLine.classes.has("enm-locate-flash"));
  // Simulate CodeMirror discarding the node while scrolling / decorating.
  current = newLine;
  oldLine.isConnected = false;
  oldLine.classes.delete("enm-locate-flash");
  flushMatching(50);
  assert.ok(newLine.classes.has("enm-locate-flash"), "重建后的行应自动重新高亮");
  assert.ok(!oldLine.classes.has("enm-locate-flash"), "旧节点不应残留");
  assert.strictEqual(
    timerMs().filter((m) => m === 1400).length,
    1,
    "重建不应重启 deadline 或叠加定时器"
  );
  f.clear();
});

t("高亮：连续定位只保留一个 deadline，旧 timer 不会提前清掉新高亮", () => {
  pendingTimers.clear();
  const { root } = flashEnv();
  const a = new FakeEl("div", { cls: "cm-line" });
  const b = new FakeEl("div", { cls: "cm-line" });
  const f = new LocateFlash();
  f.start(root, a, () => a, 1400);
  f.start(root, b, () => b, 1400);
  assert.strictEqual(timerMs().filter((m) => m === 1400).length, 1, "旧 deadline 应被取消");
  assert.ok(!a.classes.has("enm-locate-flash"), "旧行应清除");
  assert.ok(b.classes.has("enm-locate-flash"), "新行应高亮");
  f.clear();
});

t("高亮：非法设置值（NaN / 0 / 负数）回退到默认 1400ms", () => {
  pendingTimers.clear();
  const { root, line } = flashEnv();
  const f = new LocateFlash();
  f.start(root, line, () => line, NaN);
  assert.ok(timerMs().includes(1400), "NaN 不应退化成 0ms 定时器");
  assert.ok(line.classes.has("enm-locate-flash"));
  f.clear();
});

t("高亮：find() 抛错时 guard 安全跳过；clear 幂等清干净", () => {
  pendingTimers.clear();
  const { root, line } = flashEnv();
  const f = new LocateFlash();
  f.start(root, line, () => { throw new Error("CM busy"); }, 1400);
  line.isConnected = false;
  line.classes.delete("enm-locate-flash");
  flushMatching(50);
  assert.ok(!line.classes.has("enm-locate-flash"));
  f.clear();
  f.clear();
  assert.strictEqual(pendingTimers.size, 0, "clear 应取消全部定时器");
  assert.ok(!line.classes.has("enm-locate-flash-fade"));
});

console.log("\n=== " + pass + " passed" + (process.exitCode ? " (with failures)" : "") + " ===");
