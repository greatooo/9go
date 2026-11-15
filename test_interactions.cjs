/**
 * 9go 1.3.2 patch · interaction regression
 * ------------------------------------------------------------------
 *  (A) Per-cell note toggle must be a real tri-state: follow the global
 *      setting until the user clicks, then flip back and forth regardless
 *      of whether that setting is ON or OFF.
 *  (B) Clicking a thumbnail must hand the resolved image(s) to the preview
 *      callback without triggering locate / edit.
 *
 * Run: node test_interactions.cjs   (requires a fresh build: node build.js)
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
  closest(sel) {
    const parts = String(sel).split(",").map((s) => s.trim());
    return parts.some((p) =>
      p === this.tag || (p.startsWith(".") && this.classes.has(p.slice(1)))
    ) ? this : null;
  }
}
global.createDiv = (o) => new FakeEl("div", o);

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

const DIR = __dirname;
const core = require(path.join(DIR, ".core-test-bundle.cjs"));
const MAIN_JS = path.join(DIR, "..", "..", ".obsidian", "plugins", "9go", "main.js");
const bundle = require(MAIN_JS);
Module._load = origLoad;

const { MandalaGrid, previewIndex } = bundle;
const { parseOutline, STRINGS } = core;

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass += 1;
    console.log("  PASS  " + name);
  } catch (e) {
    fail += 1;
    console.error("  FAIL  " + name + " -> " + (e && e.stack ? e.stack.split("\n")[0] : e));
    process.exitCode = 1;
  }
}
async function ta(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log("  PASS  " + name);
  } catch (e) {
    fail += 1;
    console.error("  FAIL  " + name + " -> " + (e && e.stack ? e.stack.split("\n")[0] : e));
    process.exitCode = 1;
  }
}
function all(el, out) {
  out = out || [];
  out.push(el);
  for (const c of el.children) all(c, out);
  return out;
}
function byClass(root, cls) {
  return all(root).filter((e) => e.classes.has(cls));
}
function fire(el, type, evt) {
  assert.ok(el, "element missing");
  const fns = el.listeners[type] || [];
  assert.ok(fns.length, "no " + type + " listener");
  for (const fn of fns) fn(evt || {});
}
function click(el) {
  fire(el, "click", {
    target: el,
    detail: 1,
    preventDefault() {},
    stopPropagation() {},
  });
}
function mkGrid(text, opts) {
  const outline = parseOutline(text, { fileTitle: "测试笔记" });
  const host = new FakeEl("div");
  const grid = new MandalaGrid(
    host,
    outline,
    Object.assign(
      { showNotes: true, noteMaxChars: 120, autoCollapseSingleRoot: false },
      opts || {}
    )
  );
  grid.render();
  return { host, outline, grid };
}
function filled(host) { return byClass(host, "enm-cell-filled"); }
function noteBoxes(cell) { return byClass(cell, "enm-notes"); }
function toggleOf(cell) {
  const list = byClass(cell, "enm-cell-toggle");
  assert.ok(list.length, "cell has no toggle button");
  return list[0];
}
function thumbs(host) {
  return all(host).filter((e) => e.tag === "img" && e.classes.has("enm-thumb"));
}

const NOTE_TEXT = ["# 甲", "备注甲", "", "# 乙", "备注乙", ""].join("\n");
const IMG_A = "https://example.com/a.png";
const IMG_B = "https://example.com/b.png";
const NOTE_IMG =
  "# 节点甲\n\t> 说明文字 ![图一](" + IMG_A + ")\n\t> ![图二](" + IMG_B + ")\n";

(async () => {
  console.log("=== A · 备注展开/收起三态（设置 ON）===");

  t("showNotes=true：初始两格都显示备注、按钮为 ⌃", () => {
    const { host } = mkGrid(NOTE_TEXT, { showNotes: true });
    const cells = filled(host);
    assert.strictEqual(cells.length, 2);
    assert.strictEqual(noteBoxes(cells[0]).length, 1);
    assert.strictEqual(noteBoxes(cells[1]).length, 1);
    assert.strictEqual(toggleOf(cells[0])._text, "⌃");
  });

  t("showNotes=true：点第 1 格 -> 收起（备注消失、按钮变 ⌄）", () => {
    const { host } = mkGrid(NOTE_TEXT, { showNotes: true });
    click(toggleOf(filled(host)[0]));
    const cells = filled(host);
    assert.strictEqual(noteBoxes(cells[0]).length, 0);
    assert.strictEqual(toggleOf(cells[0])._text, "⌄");
    assert.strictEqual(noteBoxes(cells[1]).length, 1, "另一格不受影响");
  });

  t("showNotes=true：再点第 1 格 -> 重新展开（⌃）", () => {
    const { host } = mkGrid(NOTE_TEXT, { showNotes: true });
    click(toggleOf(filled(host)[0]));
    click(toggleOf(filled(host)[0]));
    const cells = filled(host);
    assert.strictEqual(noteBoxes(cells[0]).length, 1);
    assert.strictEqual(toggleOf(cells[0])._text, "⌃");
  });

  t("showNotes=true：连点 3 次仍按 收/放/收 稳定交替", () => {
    const { host } = mkGrid(NOTE_TEXT, { showNotes: true });
    const seq = [];
    for (let i = 0; i < 3; i += 1) {
      click(toggleOf(filled(host)[0]));
      seq.push(noteBoxes(filled(host)[0]).length === 0 ? "closed" : "open");
    }
    assert.deepStrictEqual(seq, ["closed", "open", "closed"]);
  });

  console.log("=== A · 备注展开/收起三态（设置 OFF）===");

  t("showNotes=false：初始两格都不显示备注、按钮为 ⌄", () => {
    const { host } = mkGrid(NOTE_TEXT, { showNotes: false });
    const cells = filled(host);
    assert.strictEqual(noteBoxes(cells[0]).length, 0);
    assert.strictEqual(toggleOf(cells[0])._text, "⌄");
  });

  t("showNotes=false：点一次展开、再点收起（旧版只能展开一次）", () => {
    const { host } = mkGrid(NOTE_TEXT, { showNotes: false });
    click(toggleOf(filled(host)[0]));
    assert.strictEqual(noteBoxes(filled(host)[0]).length, 1);
    assert.strictEqual(toggleOf(filled(host)[0])._text, "⌃");
    click(toggleOf(filled(host)[0]));
    assert.strictEqual(noteBoxes(filled(host)[0]).length, 0);
    assert.strictEqual(toggleOf(filled(host)[0])._text, "⌄");
  });

  t("中心格 toggle 仍是三态且可来回切换", () => {
    const { host } = mkGrid(NOTE_TEXT, { showNotes: true });
    const center = byClass(host, "enm-cell-center")[0];
    assert.ok(center);
    assert.strictEqual(toggleOf(center)._text, "⌃");
    click(toggleOf(center));
    assert.strictEqual(toggleOf(byClass(host, "enm-cell-center")[0])._text, "⌄");
    click(toggleOf(byClass(host, "enm-cell-center")[0]));
    assert.strictEqual(toggleOf(byClass(host, "enm-cell-center")[0])._text, "⌃");
  });

  t("按钮带可覆盖设置的 title 文案", () => {
    const { host } = mkGrid(NOTE_TEXT, { showNotes: true });
    const tgl = toggleOf(filled(host)[0]);
    assert.strictEqual(tgl.attrs.title, STRINGS.toggleNotesTitle.zh);
  });

  console.log("=== A · 状态快照与生命周期 ===");

  t("getNoteOverrides 记录显式 false 覆盖", () => {
    const { grid, host } = mkGrid(NOTE_TEXT, { showNotes: true });
    click(toggleOf(filled(host)[0]));
    const snap = grid.getNoteOverrides();
    assert.strictEqual(snap.length, 1);
    assert.strictEqual(snap[0][1], false);
  });

  t("applyNoteOverrides 可把状态恢复到新实例", () => {
    const { grid, host } = mkGrid(NOTE_TEXT, { showNotes: true });
    click(toggleOf(filled(host)[0]));
    const snap = grid.getNoteOverrides();
    const second = mkGrid(NOTE_TEXT, { showNotes: true });
    second.grid.applyNoteOverrides(snap);
    second.grid.render();
    assert.strictEqual(noteBoxes(filled(second.host)[0]).length, 0);
    assert.strictEqual(toggleOf(filled(second.host)[0])._text, "⌄");
  });

  t("翻页清空本层覆盖（不会串到另一页）", () => {
    const lines = [];
    for (let i = 0; i < 9; i += 1) lines.push("# 节点" + i, "备注" + i, "");
    const { grid, host } = mkGrid(lines.join("\n"), { showNotes: true });
    click(toggleOf(filled(host)[0]));
    assert.strictEqual(grid.getNoteOverrides().length, 1);
    const more = byClass(host, "enm-link-more")[0];
    assert.ok(more);
    click(more);
    assert.strictEqual(grid.getNoteOverrides().length, 0);
  });

  console.log("=== B · 缩略图点击放大（回调契约）===");

  t("点击第 1 张缩略图 -> 回调收到 1 张图与 index=0", () => {
    const calls = [];
    const { host } = mkGrid(NOTE_IMG, {
      showThumbnails: true,
      onPreviewImage: (imgs, i) => calls.push({ imgs, i }),
    });
    const imgs = thumbs(host);
    assert.strictEqual(imgs.length, 2);
    click(imgs[0]);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].imgs.length, 2);
    assert.strictEqual(calls[0].imgs[0].src, IMG_A);
    assert.strictEqual(calls[0].i, 0);
  });

  t("点击第 2 张 -> index=1，且两张都带正确 label", () => {
    const calls = [];
    const { host } = mkGrid(NOTE_IMG, {
      showThumbnails: true,
      onPreviewImage: (imgs, i) => calls.push({ imgs, i }),
    });
    click(thumbs(host)[1]);
    assert.strictEqual(calls[0].i, 1);
    assert.strictEqual(calls[0].imgs[1].src, IMG_B);
    assert.ok(calls[0].imgs[0].label.length > 0);
  });

  t("回调里拿到的是解析后的 URL，不是原始 ref", () => {
    const calls = [];
    const { host } = mkGrid(NOTE_IMG, {
      showThumbnails: true,
      resolveImageSrc: (ref) => "resolved://" + ref.src,
      onPreviewImage: (imgs, i) => calls.push({ imgs, i }),
    });
    click(thumbs(host)[0]);
    assert.strictEqual(calls[0].imgs[0].src, "resolved://" + IMG_A);
  });

  await ta("块引用异步回填后点击仍带正确 src", async () => {
    const calls = [];
    const { host } = mkGrid("# 节点甲\n\t> [[gogo+九宫#^mkp8u4]]\n", {
      showThumbnails: true,
      resolveBlockImage: () => Promise.resolve("block://image"),
      onPreviewImage: (imgs, i) => calls.push({ imgs, i }),
    });
    await new Promise((r) => setImmediate(r));
    click(thumbs(host)[0]);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].imgs[0].src, "block://image");
  });

  t("加载失败的图片点击不会打开空预览", () => {
    const calls = [];
    const { host } = mkGrid(NOTE_IMG, {
      showThumbnails: true,
      resolveImageSrc: () => null,
      onPreviewImage: (imgs, i) => calls.push({ imgs, i }),
    });
    click(thumbs(host)[0]);
    assert.strictEqual(calls.length, 0);
  });

  t("未提供回调时点击不报错（旧 harness 兼容）", () => {
    const { host } = mkGrid(NOTE_IMG, { showThumbnails: true });
    assert.doesNotThrow(() => click(thumbs(host)[0]));
  });

  t("点击图片不触发定位计时器 / 不调用 onLocate", () => {
    let located = 0;
    const { host } = mkGrid(NOTE_IMG, {
      showThumbnails: true,
      singleClickLocate: true,
      onLocate: () => { located += 1; },
      onPreviewImage: () => {},
    });
    const before = pendingTimers.size;
    click(thumbs(host)[0]);
    assert.strictEqual(pendingTimers.size, before);
    assert.strictEqual(located, 0);
  });

  t("点击图片不进入节点编辑", () => {
    let edited = 0;
    const { host } = mkGrid(NOTE_IMG, {
      showThumbnails: true,
      onEditNode: () => { edited += 1; },
      onPreviewImage: () => {},
    });
    click(thumbs(host)[0]);
    assert.strictEqual(edited, 0);
  });

  t("缩略图 aria-label 指向放大文案、鼠标样式由 CSS 提供", () => {
    const { host } = mkGrid(NOTE_IMG, { showThumbnails: true });
    assert.strictEqual(thumbs(host)[0].attrs["aria-label"], STRINGS.imageZoomTitle.zh);
    const css = fs.readFileSync(path.join(DIR, "styles.css"), "utf-8");
    assert.ok(css.includes("cursor: zoom-in"));
    assert.ok(css.includes(".enm-lightbox-img"));
  });

  t("previewIndex 环绕正确且空列表安全", () => {
    assert.strictEqual(previewIndex(0, -1, 3), 2);
    assert.strictEqual(previewIndex(2, 1, 3), 0);
    assert.strictEqual(previewIndex(1, 1, 1), 0);
    assert.strictEqual(previewIndex(5, 1, 0), 0);
  });

  console.log("=== 双语 / 产物 / 真实样本契约 ===");

  const NEW_KEYS = [
    "toggleNotesTitle", "imageZoomTitle", "imageLightboxClose",
    "imageLightboxPrev", "imageLightboxNext", "imageLightboxCounter",
    "imageLightboxHint",
  ];
  const CN = /[\u4e00-\u9fff]/;
  t("7 个新 i18n key 中英齐备、中文含中文、英文无中文", () => {
    for (const k of NEW_KEYS) {
      assert.ok(STRINGS[k], "缺 key " + k);
      assert.ok(CN.test(STRINGS[k].zh), k + ".zh 无中文");
      assert.ok(!CN.test(STRINGS[k].en), k + ".en 残留中文");
      assert.notStrictEqual(STRINGS[k].zh, STRINGS[k].en);
    }
  });

  t("打包产物含三态 / 预览 / lightbox 特征码", () => {
    const js = fs.readFileSync(MAIN_JS, "utf-8");
    ["noteOpen", "getNoteOverrides", "applyNoteOverrides", "onPreviewImage",
      "ImageLightbox", "enm-lightbox-img", "previewIndex", "toggleNotesTitle",
    ].forEach((s) => assert.ok(js.includes(s), "产物缺少：" + s));
    assert.ok(!js.includes("this.expanded"), "旧 Set 状态残留");
  });

  t("真实笔记 gogo+九宫.md 的图片备注行可渲染并触发预览", () => {
    const candidates = [
      "E:/OObsidian/0新建未分类/gogo+九宫.md",
      "E:/OObsidian/0新建未分类/gogo九宫.md",
    ];
    const real = candidates.find((p) => fs.existsSync(p));
    assert.ok(real, "真实笔记未找到（新名/旧名都试过）");
    // The image note lives several levels deep, so a top-level grid shows
    // none. Re-mount that exact raw line one level under a fresh H1.
    const lines = fs.readFileSync(real, "utf-8").split(/\r?\n/);
    const imgLine = lines.find((l) => /!\[[^\]]*\]\(/.test(l) && /csdnimg/.test(l));
    assert.ok(imgLine, "真实笔记应含外链图片备注行");
    const fixture = "# 图片节点\n\t> " + core.stripNotePrefix(imgLine) + "\n";
    const calls = [];
    const { host } = mkGrid(fixture, {
      showThumbnails: true,
      onPreviewImage: (imgs, i) => calls.push({ imgs, i }),
    });
    const imgs = thumbs(host);
    assert.ok(imgs.length > 0, "真实笔记图片备注行应渲染出缩略图");
    click(imgs[0]);
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].imgs[0].src.includes("csdnimg"));
  });

  console.log("=== " + pass + " passed / " + fail + " failed ===");
})();
