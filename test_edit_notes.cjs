/**
 * v1.3.2 patch · RAW editable notes regression.
 *
 * Bug: the EDIT modal was fed `node.notes` (cleanNote(stripImageSyntax(line))),
 * so a note line that contains ONLY an image showed an empty textarea, and a
 * no-op "save" deleted the image line from the Markdown file.
 *
 * Run: node test_edit_notes.cjs   (requires a fresh build: node build.js)
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const core = require(path.join(__dirname, ".core-test-bundle.cjs"));
const {
  parseOutline,
  cleanNote,
  stripImageSyntax,
  stripNotePrefix,
  nodeEditNotes,
  updateNode,
  extractNoteImages,
} = core;

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
function find(root, title) {
  if (root.title === title) return root;
  for (const c of root.children) {
    const hit = find(c, title);
    if (hit) return hit;
  }
  return null;
}
/** Simulate the textarea value produced by the EDIT modal. */
function modalValue(node) {
  return nodeEditNotes(node).join("\n");
}
/** Simulate clicking "保存修改" with an edited textarea value. */
function submit(text, node, value, newTitle, style) {
  return updateNode(
    text,
    node,
    { title: newTitle || node.title, notes: String(value).split(/\r?\n/) },
    style
  );
}

const CSDN = "https://img-blog.csdnimg.cn/5055383c422e4f5798afe1eb719ce3b5.png#pic_center";
// A list node indented with 2 Tabs -> its note lines live at 3 Tabs (ggm rule).
const IMG_LINE = "![[插图.png|200]] ^mkp8u4";
const BASE = [
  "# 中心",
  "",
  "\t\t- 节点甲",
  "\t\t\t> " + IMG_LINE,
  "\t\t\t- 子项",
  "",
].join("\n");

console.log("=== v1.3.2 patch · stripNotePrefix（只剥结构前缀，语法全保留）===");

t("外链图片行：URL/别名/宽度/块 ID 全部保真", () => {
  const line = "\t\t\t> ![Engelbart|200](" + CSDN + ") ^mkp8u4";
  assert.strictEqual(stripNotePrefix(line), "![Engelbart|200](" + CSDN + ") ^mkp8u4");
  assert.strictEqual(cleanNote(stripImageSyntax(line)), "", "同一行的预览文本确实为空");
});

t("库内附件 ![[x.png|200]] 原样保留", () => {
  assert.strictEqual(stripNotePrefix("\t> ![[附件/插图.png|200]]"), "![[附件/插图.png|200]]");
});

t("块引用 [[笔记#^块ID]] 原样保留", () => {
  assert.strictEqual(stripNotePrefix("> [[gogo+九宫#^mkp8u4]]"), "[[gogo+九宫#^mkp8u4]]");
});

t("普通备注的 %%标记%% 与 ^块ID 不再被洗掉", () => {
  const line = "\t> 说明 %%teal%% ^ab12";
  assert.strictEqual(stripNotePrefix(line), "说明 %%teal%% ^ab12");
  assert.strictEqual(cleanNote(line), "说明", "预览仍走旧的清洗逻辑，两者互不干扰");
});

t("顶格段落：只去缩进，内容逐字不变", () => {
  assert.strictEqual(stripNotePrefix("\t说明文字"), "说明文字");
  assert.strictEqual(stripNotePrefix("> 说明文字"), "说明文字");
});

t("不可编辑行一律跳过（callout 头 / marker / 水平线 / 围栏 / 空引用）", () => {
  ["> [!note]", "> %%fold%%", "> ---", "> ```", ">", "\t\t>   "].forEach((line) => {
    assert.strictEqual(stripNotePrefix(line), "", "应跳过：" + JSON.stringify(line));
  });
});

console.log("=== v1.3.2 patch · parseOutline / nodeEditNotes ===");

t("只有图片行的节点：notes 为空，但 editNotes / images 都在", () => {
  const o = parseOutline(BASE, { fileTitle: "x" });
  const node = find(o.root, "节点甲");
  assert.ok(node, "应解析出节点甲");
  assert.deepStrictEqual(node.notes, []);
  assert.deepStrictEqual(nodeEditNotes(node), [IMG_LINE]);
  assert.strictEqual(node.images.length, 1);
  assert.strictEqual(node.images[0].width, 200);
});

t("混合文字 + 图片：编辑框保留整行原文，预览只留文字", () => {
  const text = "# 甲\n> 先看图 ![图](" + CSDN + ")，再解释\n";
  const node = parseOutline(text, { fileTitle: "x" }).root.children[0];
  assert.strictEqual(nodeEditNotes(node)[0], "先看图 ![图](" + CSDN + ")，再解释");
  assert.ok(!node.notes[0].includes("http"), "预览不应残留 URL");
  assert.ok(node.notes[0].includes("先看图"));
});

t("多行备注顺序一致（文字 / 附件 / 块引用）", () => {
  const text = [
    "# 中心",
    "",
    "\t\t- 节点甲",
    "\t\t\t> 文字备注",
    "\t\t\t> ![[插图.png]]",
    "\t\t\t> [[gogo+九宫#^mkp8u4]]",
    "\t\t\t- 子项",
    "",
  ].join("\n");
  const o = parseOutline(text, { fileTitle: "x" });
  const node = find(o.root, "节点甲");
  assert.deepStrictEqual(nodeEditNotes(node), [
    "文字备注", "![[插图.png]]", "[[gogo+九宫#^mkp8u4]]",
  ]);
  assert.strictEqual(submit(text, node, modalValue(node)), text, "原样保存逐字不变");
});

t("nodeEditNotes：手写节点回退 notes，解析节点优先 editNotes", () => {
  assert.deepStrictEqual(nodeEditNotes({ notes: ["甲"], children: [] }), ["甲"]);
  assert.deepStrictEqual(
    nodeEditNotes({ notes: ["甲"], editNotes: ["乙"], children: [] }),
    ["乙"]
  );
});

t("真实笔记 gogo+九宫.md：目标节点编辑框能看到图片链接，整篇原样保存不变", () => {
  const candidates = [
    "E:/OObsidian/0新建未分类/gogo+九宫.md",
    "E:/OObsidian/0新建未分类/gogo九宫.md",
  ];
  const real = candidates.find((p) => fs.existsSync(p));
  assert.ok(real, "真实笔记未找到（新名/旧名都试过）");
  const raw = fs.readFileSync(real, "utf-8");
  const o = parseOutline(raw, { fileTitle: "gogo+九宫" });
  const node = find(o.root, "图片链接放到备注里");
  assert.ok(node, "应找到「图片链接放到备注里」节点");
  assert.ok(
    nodeEditNotes(node).some((s) => s.includes("zhimg.com") || s.includes("proxy.5ce.com")),
    "编辑框应含知乎图片链接"
  );
  assert.strictEqual(
    updateNode(raw, node, { title: node.title, notes: nodeEditNotes(node) }),
    raw,
    "整篇笔记必须逐字不变"
  );
});

console.log("=== v1.3.2 patch · updateNode 写回 ===");

t("打开编辑框后原样保存：图片行 / 块 ID / 缩进 / CRLF 全部不动", () => {
  const o = parseOutline(BASE, { fileTitle: "x" });
  const node = find(o.root, "节点甲");
  assert.strictEqual(submit(BASE, node, modalValue(node)), BASE);
  const crlf = BASE.replace(/\n/g, "\r\n");
  const n2 = find(parseOutline(crlf, { fileTitle: "x" }).root, "节点甲");
  assert.strictEqual(submit(crlf, n2, modalValue(n2)), crlf);
});

t("未改动保护也覆盖表格 / callout 头 / marker / 围栏等既有内容", () => {
  const text = [
    "# 甲",
    "> 普通备注",
    "| 列A | 列B |",
    "| --- | --- |",
    "> [!note]",
    "%%fold%%",
    "## 子",
    "",
  ].join("\n");
  const node = parseOutline(text, { fileTitle: "x" }).root.children[0];
  assert.strictEqual(submit(text, node, modalValue(node)), text);
});

t("在图片备注后新增一行文字：图片行与新行都写回正确缩进", () => {
  const o = parseOutline(BASE, { fileTitle: "x" });
  const node = find(o.root, "节点甲");
  const next = submit(BASE, node, modalValue(node) + "\n新增一行说明");
  assert.ok(next.includes("\t\t\t> " + IMG_LINE), "图片行仍在：\n" + next);
  assert.ok(next.includes("\t\t\t> 新增一行说明"));
  assert.ok(next.indexOf("新增一行说明") < next.indexOf("\t\t\t- 子项"), "备注仍在子节点之前");
  const n2 = find(parseOutline(next, { fileTitle: "x" }).root, "节点甲");
  assert.strictEqual(n2.images.length, 1, "写回后仍可抽出缩略图");
});

t("在编辑框里改图片名：旧链接消失、新链接可再次抽图", () => {
  const o = parseOutline(BASE, { fileTitle: "x" });
  const node = find(o.root, "节点甲");
  const next = submit(BASE, node, modalValue(node).replace("插图.png", "新图.png"));
  assert.ok(next.includes("新图.png"));
  assert.ok(!next.includes("插图.png"));
  const imgLine = next.split(/\r?\n/).find((l) => l.includes("新图.png"));
  assert.strictEqual(extractNoteImages(imgLine)[0].src, "新图.png");
});

t("在编辑框里删掉图片行：图片确实被删除，子树不动", () => {
  const o = parseOutline(BASE, { fileTitle: "x" });
  const node = find(o.root, "节点甲");
  const next = submit(BASE, node, "");
  assert.ok(!next.includes("插图.png"));
  assert.ok(next.includes("\t\t\t- 子项"));
  assert.strictEqual(find(parseOutline(next, { fileTitle: "x" }).root, "节点甲").images.length, 0);
});

t("只改标题、备注不动：图片行原样保留", () => {
  const o = parseOutline(BASE, { fileTitle: "x" });
  const node = find(o.root, "节点甲");
  const next = submit(BASE, node, modalValue(node), "节点甲改");
  assert.ok(next.includes("\t\t- 节点甲改"));
  assert.ok(next.includes("\t\t\t> " + IMG_LINE));
});

t("块引用备注改写后仍是块引用（^块ID 不丢）", () => {
  const text = "# 甲\n> [[gogo+九宫#^mkp8u4]]\n";
  const node = parseOutline(text, { fileTitle: "x" }).root.children[0];
  assert.strictEqual(modalValue(node), "[[gogo+九宫#^mkp8u4]]");
  const next = submit(text, node, modalValue(node) + "\n文字说明");
  assert.ok(next.includes("> [[gogo+九宫#^mkp8u4]]"));
  assert.ok(next.includes("> 文字说明"));
  const n2 = parseOutline(next, { fileTitle: "x" }).root.children[0];
  assert.strictEqual(n2.images[0].kind, "block");
  assert.strictEqual(n2.images[0].blockId, "mkp8u4");
});

t("paragraph 风格同样保留图片链接（只是不加 > 前缀）", () => {
  const o = parseOutline(BASE, { fileTitle: "x" });
  const node = find(o.root, "节点甲");
  const next = submit(BASE, node, modalValue(node) + "\n新增说明", null, "paragraph");
  assert.ok(next.includes("\t\t\t" + IMG_LINE));
  assert.ok(!next.includes("\t\t\t> " + IMG_LINE));
  assert.ok(next.includes("\t\t\t新增说明"));
});

t("真实笔记模拟改 URL：全文只有目标备注行变化，其它节点逐字不动", () => {
  const candidates = [
    "E:/OObsidian/0新建未分类/gogo+九宫.md",
    "E:/OObsidian/0新建未分类/gogo九宫.md",
  ];
  const real = candidates.find((p) => fs.existsSync(p));
  assert.ok(real, "真实笔记未找到（新名/旧名都试过）");
  const raw = fs.readFileSync(real, "utf-8");
  const node = find(parseOutline(raw, { fileTitle: "gogo+九宫" }).root, "图片链接放到备注里");
  assert.ok(node);
  const before = nodeEditNotes(node);
  const edited = before.map((s) => s.replace(/zhimg\.com/, "example.com"));
  assert.notDeepStrictEqual(edited, before, "样例必须真的含 zhimg.com");
  const next = updateNode(raw, node, { title: node.title, notes: edited });
  assert.notStrictEqual(next, raw);
  const a = raw.split(/\r?\n/);
  const b = next.split(/\r?\n/);
  assert.strictEqual(b.length, a.length, "行数不应变化");
  const diff = [];
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) diff.push(i);
  assert.strictEqual(diff.length, 1, "只应有 1 行变化，实际：" + JSON.stringify(diff));
  assert.ok(a[diff[0]].includes("zhimg.com"));
  assert.ok(b[diff[0]].includes("example.com"));
  assert.ok(b[diff[0]].startsWith("\t\t\t> !["), "写回仍是 3 Tab + 引用块");
});

console.log("=== v1.3.2 patch · 打包产物契约 ===");

t("部署的 main.js 已改为传原始备注，且编辑框提示含图片说明", () => {
  const deployed = path.join(
    __dirname, "..", "..", ".obsidian", "plugins", "9go", "main.js"
  );
  assert.ok(fs.existsSync(deployed), "未找到部署产物，请先跑 node build.js");
  const js = fs.readFileSync(deployed, "utf-8");
  assert.ok(/function nodeEditNotes\(/.test(js), "打包产物应包含 nodeEditNotes 定义");
  assert.ok(/nodeEditNotes\(target\)/.test(js), "editNode 应传原始备注对象");
  assert.ok(!/notes:\s*target\.notes/.test(js), "不应再把清洗后的 notes 传给编辑框");
  assert.ok(js.includes("图片链接 / ![[附件]]"), "编辑框占位提示应说明图片可编辑");
});

console.log("=== " + pass + " passed / " + fail + " failed ===");
