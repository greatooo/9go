/**
 * v1.3.2 · image thumbnails regression (pure parser + DOM grid).
 * Run: node test_images.cjs   (requires a fresh build: node build.js)
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

const core = require(path.join(__dirname, ".core-test-bundle.cjs"));
const bundle = require(
  path.join(__dirname, "..", "..", ".obsidian", "plugins", "9go", "main.js")
);
Module._load = origLoad;

const { MandalaGrid } = bundle;
const {
  parseOutline,
  extractNoteImages,
  stripImageSyntax,
  cleanNote,
  notePreview,
  notePreviewRaw,
} = core;

let pass = 0;
let fail = 0;
async function t(name, fn) {
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
function thumbImgs(host) {
  return all(host).filter((e) => e.tag === "img" && e.classes.has("enm-thumb"));
}
const CSDN = "https://img-blog.csdnimg.cn/5055383c422e4f5798afe1eb719ce3b5.png#pic_center";
const NOTE_WITH_IMAGE = "# 节点甲\n\t> ![Engelbart|200](" + CSDN + ") ^mkp8u4\n";

(async () => {
  console.log("=== v1.3.2 图片引用抽取（纯函数）===");

  await t("外链 Markdown 图片：kind/URL/alt/宽度全部保真", () => {
    const r = extractNoteImages("> ![Engelbart|200](" + CSDN + ") ^mkp8u4");
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].kind, "external");
    assert.strictEqual(r[0].src, CSDN);
    assert.strictEqual(r[0].alt, "Engelbart");
    assert.strictEqual(r[0].width, 200);
  });

  await t("真实备注行剥离图片语法后 cleanNote 为空", () => {
    const line = "\t\t\t> ![Engelbart|200](" + CSDN + ") ^mkp8u4";
    assert.strictEqual(cleanNote(stripImageSyntax(line)), "");
  });

  await t("混合文字 + 图片：只删图片语法，文字保留", () => {
    const line = "> 先看图 ![图](" + CSDN + ")，再解释";
    assert.strictEqual(extractNoteImages(line).length, 1);
    assert.ok(cleanNote(stripImageSyntax(line)).includes("先看图"));
    assert.ok(cleanNote(stripImageSyntax(line)).includes("再解释"));
  });

  await t("库内附件 ![[插图.png|200]] -> file + 宽度", () => {
    const r = extractNoteImages("> ![[附件/插图.png|200]]");
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].kind, "file");
    assert.strictEqual(r[0].src, "附件/插图.png");
    assert.strictEqual(r[0].width, 200);
  });

  await t("外链 wikilink ![[https://…/a.png]] -> external", () => {
    const r = extractNoteImages("![[https://example.com/a.png]]");
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].kind, "external");
  });

  await t("块引用 [[gogo+九宫#^mkp8u4]] -> block + blockId", () => {
    const r = extractNoteImages("- 图片节点 [[gogo+九宫#^mkp8u4]]");
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].kind, "block");
    assert.strictEqual(r[0].src, "gogo+九宫");
    assert.strictEqual(r[0].blockId, "mkp8u4");
  });

  await t("嵌入块引用 ![[笔记#^id]] 同样识别", () => {
    const r = extractNoteImages("![[笔记#^abc-1]]");
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].blockId, "abc-1");
  });

  await t("普通 wikilink / 普通 Markdown 链接不算图片", () => {
    assert.strictEqual(extractNoteImages("[[普通笔记]] [文字](https://x.com)").length, 0);
  });

  await t("不含图片的行：strip 后 cleanNote 逐字不变", () => {
    const line = "\t> 这是一条普通备注";
    assert.strictEqual(cleanNote(stripImageSyntax(line)), cleanNote(line));
    assert.strictEqual(extractNoteImages(line).length, 0);
  });

  console.log("=== v1.3.2 真实笔记目标节点 ===");

  await t("gogo+九宫.md「同级一圈时」节点抽出 1 张外链图", () => {
    const candidates = [
      "E:/OObsidian/0新建未分类/gogo+九宫.md",
      "E:/OObsidian/0新建未分类/gogo九宫.md",
    ];
    const real = candidates.find((p) => fs.existsSync(p));
    assert.ok(real, "真实笔记未找到（新名/旧名都试过）");
    const outline = parseOutline(fs.readFileSync(real, "utf-8"), {
      fileTitle: "gogo+九宫",
    });
    const find = (n) => {
      if (n.title === "同级一圈时") return n;
      for (const c of n.children) {
        const hit = find(c);
        if (hit) return hit;
      }
      return null;
    };
    const hit = find(outline.root);
    assert.ok(hit, "应找到「同级一圈时」节点");
    assert.strictEqual(hit.images.length, 1);
    assert.strictEqual(hit.images[0].kind, "external");
    assert.ok(hit.images[0].src.includes("csdnimg"));
    assert.strictEqual(hit.images[0].width, 200);
    assert.ok(!notePreview(hit, 120).includes("Engelbart"), "开缩略图时纯文本不含 alt 残留");
    assert.ok(notePreviewRaw(hit, 120).includes("Engelbart"), "关缩略图时保留旧文本");
  });

  console.log("=== v1.3.2 DOM 缩略图渲染 ===");

  await t("开启缩略图：生成 img + 回调解析 src + 高度变量", () => {
    const { host } = mkGrid(NOTE_WITH_IMAGE, {
      showThumbnails: true,
      resolveImageSrc: (ref) => "resolved://" + ref.src,
    });
    const wraps = byClass(host, "enm-thumbs");
    assert.strictEqual(wraps.length, 1);
    assert.ok(String(wraps[0].attrs.style).includes("--enm-thumb-max-h:96px"));
    const imgs = thumbImgs(host);
    assert.strictEqual(imgs.length, 1);
    assert.strictEqual(imgs[0].attrs.src, "resolved://" + CSDN);
    assert.strictEqual(imgs[0].attrs.alt, "Engelbart");
    assert.strictEqual(imgs[0].attrs.loading, "lazy");
  });

  await t("外链图片无回调时也能直接用 URL", () => {
    const { host } = mkGrid(NOTE_WITH_IMAGE, { showThumbnails: true });
    assert.strictEqual(thumbImgs(host)[0].attrs.src, CSDN);
  });

  await t("关闭开关（旧 harness 路径）：无 img，纯文本退回 1.3.1", () => {
    const { host } = mkGrid(NOTE_WITH_IMAGE, {});
    assert.strictEqual(thumbImgs(host).length, 0);
    const notes = byClass(host, "enm-notes");
    assert.ok(notes.length >= 1);
    assert.ok(notes.some((e) => String(e._text).includes("Engelbart")));
  });

  await t("每格最多 3 张缩略图", () => {
    const lines = ["# 节点甲"];
    for (let i = 0; i < 5; i += 1) {
      lines.push("\t> ![图" + i + "](https://example.com/" + i + ".png)");
    }
    const { host } = mkGrid(lines.join("\n"), { showThumbnails: true });
    assert.strictEqual(thumbImgs(host).length, 3);
  });

  await t("缩略图高度钳制到 320px", () => {
    const { host } = mkGrid(NOTE_WITH_IMAGE, {
      showThumbnails: true,
      thumbMaxHeight: 9999,
    });
    assert.ok(String(byClass(host, "enm-thumbs")[0].attrs.style).includes("320px"));
  });

  await t("加载失败触发 error 时隐藏图片", () => {
    const { host } = mkGrid(NOTE_WITH_IMAGE, { showThumbnails: true });
    const img = thumbImgs(host)[0];
    fire(img, "error", {});
    assert.ok(img.classes.has("enm-thumb-failed"));
  });

  await t("块引用异步回填 src", async () => {
    const { host } = mkGrid("# 节点甲\n\t> [[gogo+九宫#^mkp8u4]]\n", {
      showThumbnails: true,
      resolveBlockImage: () => Promise.resolve("block://image"),
    });
    const img = thumbImgs(host)[0];
    assert.ok(img, "应先创建占位 img");
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(img.attrs.src, "block://image");
  });

  await t("块引用解析失败时不留破图", async () => {
    const { host } = mkGrid("# 节点甲\n\t> [[无此笔记#^nope]]\n", {
      showThumbnails: true,
      resolveBlockImage: () => Promise.resolve(null),
    });
    const img = thumbImgs(host)[0];
    await new Promise((r) => setImmediate(r));
    assert.ok(img.classes.has("enm-thumb-failed"));
  });

  await t("点击缩略图不触发单击定位", () => {
    let located = 0;
    const { host } = mkGrid(NOTE_WITH_IMAGE, {
      showThumbnails: true,
      singleClickLocate: true,
      onLocate: () => { located += 1; },
    });
    const cell = byClass(host, "enm-cell-filled")[0];
    const img = thumbImgs(host)[0];
    assert.ok(cell && img);
    const before = pendingTimers.size;
    for (const fn of cell.listeners.click || []) {
      fn({ target: img, detail: 1, preventDefault() {}, stopPropagation() {} });
    }
    assert.strictEqual(pendingTimers.size, before, "点图片不应调度定位计时器");
    assert.strictEqual(located, 0);
  });

  console.log("=== " + pass + " passed / " + fail + " failed ===");
})();
