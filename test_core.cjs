/**
 * Unit tests for the pure core (parser + layout).
 * Run: node test_core.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const core = require(path.join(__dirname, ".core-test-bundle.cjs"));
const {
  parseOutline,
  cleanTitle,
  cleanNote,
  notePreview,
  collapseSingleRoot,
  findNodeByLine,
  findNodeAtLine,
  nodePath,
  insertChildNode,
  updateNode,
  promoteChildNode,
  childMarker,
  lineLevel,
  sectionEndLine,
  reorderChildren,
  buildSlots,
  childNumber,
  compactNumber,
  moveIndices,
  dropFinalAt,
  FIRST_SLOT_ORDER,
  RING_CW,
  RING_CCW,
  PAGE_SIZE,
  SLOT_POS,
  CELL_LABEL,
  cellLabel,
  totalPages,
  clampPage,
  pageSlice,
  nextPageRange,
  moreRange,
} = core;

let pass = 0;
function t(name, fn) {
  try {
    fn();
    pass += 1;
    console.log("  PASS  " + name);
  } catch (e) {
    console.error("  FAIL  " + name + " -> " + e.message);
    process.exitCode = 1;
  }
}

console.log("=== layout ===");

t("PAGE_SIZE = 8", () => assert.strictEqual(PAGE_SIZE, 8));

t("顺时针顺序：正上方起，左上角为第 8 个", () => {
  const expect = [
    [0, 1], [0, 2], [1, 2], [2, 2],
    [2, 1], [2, 0], [1, 0], [0, 0],
  ];
  assert.deepStrictEqual(SLOT_POS, expect);
});

t("8 个格位互不重复且都在 3x3 内（不含中心）", () => {
  const seen = new Set();
  for (const [r, c] of SLOT_POS) {
    assert.ok(r >= 0 && r <= 2 && c >= 0 && c <= 2);
    assert.ok(!(r === 1 && c === 1), "中心格不能被占用");
    const k = `${r},${c}`;
    assert.ok(!seen.has(k), "格位重复: " + k);
    seen.add(k);
  }
  assert.strictEqual(seen.size, 8);
});

t("格位标签 1.1–1.8 与参考图一致", () => {
  assert.strictEqual(CELL_LABEL["0,0"], "1.1");
  assert.strictEqual(CELL_LABEL["0,1"], "1.2");
  assert.strictEqual(CELL_LABEL["0,2"], "1.3");
  assert.strictEqual(CELL_LABEL["1,0"], "1.4");
  assert.strictEqual(CELL_LABEL["1,2"], "1.5");
  assert.strictEqual(CELL_LABEL["2,0"], "1.6");
  assert.strictEqual(CELL_LABEL["2,1"], "1.7");
  assert.strictEqual(CELL_LABEL["2,2"], "1.8");
  assert.strictEqual(cellLabel(0, 1), "1.2");
  assert.strictEqual(cellLabel(1, 1), "");
});

t("分页：0/8=1页，9/16=2页，17/24=3页，25=4页", () => {
  assert.strictEqual(totalPages(0), 1);
  assert.strictEqual(totalPages(8), 1);
  assert.strictEqual(totalPages(9), 2);
  assert.strictEqual(totalPages(16), 2);
  assert.strictEqual(totalPages(17), 3);
  assert.strictEqual(totalPages(24), 3);
  assert.strictEqual(totalPages(25), 4);
});

t("pageSlice 每页 8 个，末页余数正确", () => {
  const items = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.deepStrictEqual(pageSlice(items, 0), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepStrictEqual(pageSlice(items, 1), [9, 10, 11, 12, 13, 14, 15, 16]);
  assert.deepStrictEqual(pageSlice(items, 2), [17, 18, 19, 20]);
  assert.deepStrictEqual(pageSlice(items, 99), [17, 18, 19, 20]);
});

t("clampPage 边界", () => {
  assert.strictEqual(clampPage(-5, 20), 0);
  assert.strictEqual(clampPage(2, 20), 2);
  assert.strictEqual(clampPage(99, 20), 2);
  assert.strictEqual(clampPage(99, 3), 0);
});

t("更多子节点范围文案 9–16 / 17–24", () => {
  assert.deepStrictEqual(nextPageRange(20, 0), [9, 16]);
  assert.deepStrictEqual(nextPageRange(20, 1), [17, 20]);
  assert.deepStrictEqual(nextPageRange(12, 0), [9, 12]);
});

t("moreRange：有真实子节点封顶实际数，无则显示整批 9–16", () => {
  assert.deepStrictEqual(moreRange(10, 0), [9, 10]);
  assert.deepStrictEqual(moreRange(12, 0), [9, 12]);
  assert.deepStrictEqual(moreRange(20, 0), [9, 16]);
  assert.deepStrictEqual(moreRange(20, 1), [17, 20]);
  assert.deepStrictEqual(moreRange(3, 0), [9, 16]);
  assert.deepStrictEqual(moreRange(8, 0), [9, 16]);
  assert.deepStrictEqual(moreRange(9, 0), [9, 9]);
  assert.deepStrictEqual(moreRange(10, 1), [17, 24]);
});

console.log("=== promoteChildNode（拖到中心 = 上升一级）===");

t("标题式：### 上升为 ##，插到中心整段之后，备注/子树随行", () => {
  const text = [
    "# 父",
    "",
    "## 甲",
    "",
    "### 甲1",
    "甲1的备注",
    "",
    "### 甲2",
    "",
    "## 乙",
    "",
  ].join("\n");
  const outline = parseOutline(text, { fileTitle: "x" });
  const fu = outline.root.children.find((c) => c.title === "父");
  const jia = fu.children.find((c) => c.title === "甲");
  const next = promoteChildNode(text, jia, 0);
  const lines = next.split("\n");
  assert.ok(lines.includes("## 甲1"), "标题层级应重写为 ##：\n" + next);
  assert.ok(lines.includes("甲1的备注"), "备注应随行");
  assert.ok(lines.includes("### 甲2"), "原兄弟不受影响");
  const again = parseOutline(next, { fileTitle: "x" });
  const fu2 = again.root.children.find((c) => c.title === "父");
  const titles = fu2.children.map((c) => c.title);
  assert.deepStrictEqual(titles, ["甲", "甲1", "乙"], "甲1 应成为父级的新兄弟");
  const jia2 = fu2.children[0];
  assert.deepStrictEqual(
    jia2.children.map((c) => c.title),
    ["甲2"]
  );
  const promoted = fu2.children[1];
  assert.deepStrictEqual(
    promoted.notes,
    ["甲1的备注"],
    "备注应仍挂在上升后的甲1名下"
  );
});

t("列表式：子项缩进上升为与中心同级缩进", () => {
  const text = [
    "# 根",
    "",
    "- 甲",
    "\t- 甲1",
    "\t- 甲2",
    "",
    "- 乙",
    "",
  ].join("\n");
  const outline = parseOutline(text, { fileTitle: "x" });
  const gen = outline.root.children.find((c) => c.title === "根");
  const jia = gen.children.find((c) => c.title === "甲");
  const next = promoteChildNode(text, jia, 0);
  const lines = next.split("\n");
  assert.ok(lines.includes("- 甲1"), "应重写为顶层列表项：\n" + JSON.stringify(lines));
  const again = parseOutline(next, { fileTitle: "x" });
  const gen2 = again.root.children.find((c) => c.title === "根");
  assert.deepStrictEqual(
    gen2.children.map((c) => c.title),
    ["甲", "甲1", "乙"]
  );
  assert.deepStrictEqual(
    gen2.children[0].children.map((c) => c.title),
    ["甲2"]
  );
});

t("无法上升：根中心 / 越界索引 → 原文返回", () => {
  const text = "# 父\n\n## 甲\n\n## 乙\n";
  const outline = parseOutline(text, { fileTitle: "x" });
  assert.strictEqual(promoteChildNode(text, outline.root, 0), text);
  const fu = outline.root.children[0];
  assert.strictEqual(promoteChildNode(text, fu, -1), text);
  assert.strictEqual(promoteChildNode(text, fu, 5), text);
});

console.log("=== cleanTitle / cleanNote ===");

t("wikilink 别名", () => {
  assert.strictEqual(cleanTitle("[[目标笔记|短标签]]"), "短标签");
  assert.strictEqual(cleanTitle("[[ob候选插件#gogoga Mind Map|gogoga思维导图]]"), "gogoga思维导图");
});

t("块内 [[#标题]] 返回标题文字而非 #标题", () => {
  assert.strictEqual(cleanTitle("[[#优势 fold fold]]"), "优势 fold fold");
});

t("剥离 %%标记%%、块 id、粗体、反引号", () => {
  assert.strictEqual(cleanTitle("- 三级无序大纲 %%teal%%"), "- 三级无序大纲");
  // leading "- " is not stripped here (list marker is removed by the parser)
  assert.strictEqual(cleanTitle("文本 ^35ts3k"), "文本");
  assert.strictEqual(cleanTitle("**重点**"), "重点");
  assert.strictEqual(cleanTitle("`code`"), "code");
});

t("callout 备注去掉 > 前缀，[!note] 行忽略", () => {
  assert.strictEqual(cleanNote("> 一条备注"), "一条备注");
  assert.strictEqual(cleanNote("> [!note]"), "");
  assert.strictEqual(cleanNote("> 列表项 %%red%%"), "列表项");
});

t("notePreview 截断", () => {
  const node = { notes: ["第一段", "第二段"], children: [] };
  assert.strictEqual(notePreview(node, 0), "第一段\n第二段");
  const short = notePreview(node, 4);
  assert.ok(short.endsWith("…"));
  assert.ok(short.length <= 6);
  assert.strictEqual(notePreview({ notes: [], children: [] }, 10), "");
});

console.log("=== parser（构造样本）===");

function md(heads, withNotes) {
  const lines = ["---", "tags: []", "---", ""];
  heads.forEach((h, i) => {
    lines.push("# " + h);
    if (withNotes) lines.push("备注-" + h);
    lines.push("");
    lines.push("## " + h + "-子A");
    lines.push("");
    lines.push("## " + h + "-子B");
    lines.push("");
    void i;
  });
  return lines.join("\n");
}

t("frontmatter 被剥离，root = 文件名，H1 为下一级", () => {
  const o = parseOutline(md(["甲", "乙", "丙"], true), { fileTitle: "测试笔记" });
  assert.strictEqual(o.root.title, "测试笔记");
  assert.strictEqual(o.root.children.length, 3);
  assert.deepStrictEqual(o.root.children.map((n) => n.title), ["甲", "乙", "丙"]);
  assert.ok(!JSON.stringify(o.root.notes).includes("tags"));
});

t("H1 的下一级是 H2（下钻层级正确）", () => {
  const o = parseOutline(md(["甲"], false), { fileTitle: "测试笔记" });
  const h1 = o.root.children[0];
  assert.deepStrictEqual(h1.children.map((n) => n.title), ["甲-子A", "甲-子B"]);
});

t("备注归给 H1 而非 H2", () => {
  const o = parseOutline(md(["甲"], true), { fileTitle: "测试笔记" });
  assert.ok(o.root.children[0].notes.includes("备注-甲"));
});

t("代码块内容完全跳过", () => {
  const text = ["# 根", "", "```dataviewjs", "const x = 1;", "```", "", "正文备注"].join("\n");
  const o = parseOutline(text, { fileTitle: "x" });
  assert.ok(!JSON.stringify(o.root.notes).includes("const x"));
  assert.ok(!JSON.stringify(o.root).includes("const x"));
  assert.ok(o.root.children[0].notes.includes("正文备注"));
});

t("%%标记%% 单独一行不进备注", () => {
  const text = ["# 根", "%%w=187%%", "真正的备注"].join("\n");
  const o = parseOutline(text, { fileTitle: "x" });
  assert.ok(!JSON.stringify(o.root.children[0].notes).includes("%%"));
  assert.ok(o.root.children[0].notes.includes("真正的备注"));
});

t("列表缩进层级 + Tab 备注归属（真实 gogoga 写法）", () => {
  const text = [
    "# 中心",
    "",
    "- 一级无序大纲",
    "\t四级住下是大纲",
    "\t- 二级无序大纲",
    "\t\t同级内容备注的位置",
  ].join("\n");
  const o = parseOutline(text, { fileTitle: "x" });
  const h1 = o.root.children[0];
  assert.strictEqual(h1.children.length, 1);
  const l1 = h1.children[0];
  assert.strictEqual(l1.title, "一级无序大纲");
  assert.ok(l1.notes.includes("四级住下是大纲"));
  assert.strictEqual(l1.children.length, 1);
  assert.strictEqual(l1.children[0].title, "二级无序大纲");
  assert.ok(l1.children[0].notes.includes("同级内容备注的位置"));
});

t("无标题的纯列表笔记", () => {
  const o = parseOutline("- A\n- B\n- C", { fileTitle: "列表笔记" });
  assert.strictEqual(o.root.children.length, 3);
  assert.deepStrictEqual(o.root.children.map((n) => n.title), ["A", "B", "C"]);
});

t("空文件不崩溃", () => {
  const o = parseOutline("", { fileTitle: "空" });
  assert.strictEqual(o.root.children.length, 0);
  assert.strictEqual(o.root.title, "空");
});

t("rootSource=firstH1 只改标题文字，不丢兄弟节点", () => {
  const o = parseOutline(md(["甲", "乙"], false), {
    fileTitle: "文件名",
    rootSource: "firstH1",
  });
  assert.strictEqual(o.root.title, "甲");
  assert.strictEqual(o.root.children.length, 2, "兄弟 H1 不能丢");
});

t("12 个子节点 -> 2 页，第 2 页 4 个，顺时针映射正确", () => {
  const heads = Array.from({ length: 12 }, (_, i) => "节点" + (i + 1));
  const o = parseOutline(md(heads, false), { fileTitle: "分页" });
  assert.strictEqual(o.root.children.length, 12);
  assert.strictEqual(totalPages(12), 2);
  assert.strictEqual(pageSlice(o.root.children, 1).length, 4);
  assert.strictEqual(pageSlice(o.root.children, 1)[0].title, "节点9");
  // 第 9 个节点落在正上方 (row 0, col 1)
  assert.deepStrictEqual(SLOT_POS[0], [0, 1]);
});

t("collapseSingleRoot：唯一 H1 时返回 [root, H1]，仍可返回上级", () => {
  const o = parseOutline(md(["唯一"], false), { fileTitle: "x" });
  const chain = collapseSingleRoot(o.root);
  assert.strictEqual(chain.length, 2);
  assert.strictEqual(chain[0].title, "x");
  assert.strictEqual(chain[1].title, "唯一");
});

console.log("=== parser（真实笔记样本）===");

const REAL = "E:/OObsidian/0新建未分类/gogoga-思维导图.md";
if (fs.existsSync(REAL)) {
  const text = fs.readFileSync(REAL, "utf-8");
  const o = parseOutline(text, { fileTitle: "gogoga-思维导图" });
  t("真实笔记：根标题 = 文件名，H1 数 >= 1", () => {
    assert.strictEqual(o.root.title, "gogoga-思维导图");
    assert.ok(o.root.children.length >= 1);
  });
  t("真实笔记：H1 标题取 wikilink 别名", () => {
    assert.strictEqual(o.root.children[0].title, "gogoga思维导图");
  });
  t("真实笔记：H1 下有 H2 子节点", () => {
    const h2 = o.root.children[0].children.filter((n) => n.level === 2);
    assert.ok(h2.length >= 2, "应有至少 2 个 H2，实际 " + h2.length);
  });
  t("真实笔记：dataviewjs 代码未污染节点/备注", () => {
    const s = JSON.stringify(o.root);
    assert.ok(!s.includes("startHeadinglevel"), "代码块内容泄漏");
    assert.ok(!s.includes("dv.container"), "代码块内容泄漏");
  });
  t("真实笔记：frontmatter 未污染", () => {
    assert.ok(!JSON.stringify(o.root.notes).includes("mindmap-edge"));
  });
  t("真实笔记：显示文本中 %%标记%% 已清除（raw 保留原文属设计）", () => {
    const parts = [];
    const walk = (n) => {
      parts.push(n.title, ...n.notes);
      n.children.forEach(walk);
    };
    walk(o.root);
    const leaked = parts.filter((s) => String(s).includes("%%"));
    assert.strictEqual(leaked.length, 0, "标题/备注仍含 %%: " + leaked.slice(0, 3).join(" | "));
  });
  t("真实笔记：备注有内容（Tab 缩进续行被采集）", () => {
    const s = JSON.stringify(o.root);
    assert.ok(s.includes("四级住下是大纲"), "一级列表下的 Tab 备注应被采集");
  });
} else {
  console.log("  SKIP  真实笔记样本不存在：" + REAL);
}

console.log("=== v1.1.0 新建节点：层级判定 ===");

t("lineLevel 判定标题 / 列表缩进 / 其它", () => {
  assert.strictEqual(lineLevel("# 甲"), 1);
  assert.strictEqual(lineLevel("###### 六"), 6);
  assert.strictEqual(lineLevel("- 项"), 7);
  assert.strictEqual(lineLevel("\t- 项"), 8);
  assert.strictEqual(lineLevel("   - 项"), 8);
  assert.strictEqual(lineLevel("普通正文"), null);
  assert.strictEqual(lineLevel("```md"), null);
});

t("childMarker：根 / H1 / H2 分别生成 # / ## / ###", () => {
  const text = "# A\n\n## A1\n\n# B\n";
  const o = parseOutline(text, { fileTitle: "笔记" });
  assert.strictEqual(childMarker(text, o.root), "# ");
  assert.strictEqual(childMarker(text, o.root.children[0]), "## ");
  assert.strictEqual(childMarker(text, o.root.children[0].children[0]), "### ");
});

t("childMarker：列表子节点克隆缩进", () => {
  const text = "# 中心\n\n- A\n\t- A1\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const h1 = o.root.children[0];
  assert.strictEqual(childMarker(text, h1), "- ");
  assert.strictEqual(childMarker(text, h1.children[0]), "\t- ");
});

t("findNodeByLine 按绝对行号定位（含 frontmatter 偏移）", () => {
  const text = "---\ntags: []\n---\n\n# 甲\n\n## 甲1\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const h2 = o.root.children[0].children[0];
  assert.strictEqual(findNodeByLine(o.root, h2.line).title, "甲1");
  assert.strictEqual(findNodeByLine(o.root, 0).title, "x");
  assert.strictEqual(findNodeByLine(o.root, 999), null);
});

console.log("=== v1.1.0 新建节点：写回 Markdown ===");

t("根层新增：追加 H1 到末尾，备注成为新节点 notes", () => {
  const text = "# 甲\n\n## 甲1\n\n# 乙\n";
  const o = parseOutline(text, { fileTitle: "笔记" });
  const next = insertChildNode(text, o.root, { title: "丙", notes: ["丙的备注"] });
  assert.ok(next.includes("# 丙"));
  assert.ok(next.includes("> 丙的备注"));
  const o2 = parseOutline(next, { fileTitle: "笔记" });
  assert.deepStrictEqual(o2.root.children.map((n) => n.title), ["甲", "乙", "丙"]);
  assert.ok(o2.root.children[2].notes.includes("丙的备注"));
});

t("H1 下新增 H2：插在下一个 H1 之前，不串到兄弟节点", () => {
  const text = "# 甲\n\n## 甲1\n\n# 乙\n\n## 乙1\n";
  const o = parseOutline(text, { fileTitle: "笔记" });
  const next = insertChildNode(text, o.root.children[0], { title: "甲2", notes: [] });
  const o2 = parseOutline(next, { fileTitle: "笔记" });
  assert.deepStrictEqual(o2.root.children.map((n) => n.title), ["甲", "乙"]);
  assert.deepStrictEqual(o2.root.children[0].children.map((n) => n.title), ["甲1", "甲2"]);
  assert.deepStrictEqual(o2.root.children[1].children.map((n) => n.title), ["乙1"]);
});

t("列表中心：新节点保持同一层级并被解析为子节点", () => {
  const text = "# 中心\n\n- A\n\t- A1\n\n- B\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const h1 = o.root.children[0];
  const next = insertChildNode(text, h1, { title: "C", notes: ["C备注"] });
  const o2 = parseOutline(next, { fileTitle: "x" });
  assert.deepStrictEqual(o2.root.children[0].children.map((n) => n.title), ["A", "B", "C"]);
  assert.ok(o2.root.children[0].children[2].notes.includes("C备注"));
});

t("paragraph 备注：危险前缀被保护，不会生成额外节点", () => {
  const text = "# 根\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const next = insertChildNode(
    text, o.root,
    { title: "新节点", notes: ["普通备注", "# 看起来像标题", "- 看起来像列表"] },
    "paragraph"
  );
  const o2 = parseOutline(next, { fileTitle: "x" });
  assert.deepStrictEqual(o2.root.children.map((n) => n.title), ["根", "新节点"]);
  const nn = o2.root.children[1];
  assert.ok(nn.notes.some((s) => s.includes("看起来像标题")));
  assert.ok(nn.notes.some((s) => s.includes("看起来像列表")));
});

t("代码块内的 # 假标题不会截断 section 边界", () => {
  const text = "# 甲\n\n```md\n# 假标题\n```\n\n## 甲1\n\n# 乙\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const next = insertChildNode(text, o.root.children[0], { title: "甲2", notes: [] });
  const o2 = parseOutline(next, { fileTitle: "x" });
  assert.deepStrictEqual(o2.root.children[0].children.map((n) => n.title), ["甲1", "甲2"]);
  assert.deepStrictEqual(o2.root.children[1].title, "乙");
});

t("空标题返回原文（不写坏笔记）", () => {
  const text = "# 甲\n";
  const o = parseOutline(text, { fileTitle: "x" });
  assert.strictEqual(insertChildNode(text, o.root, { title: "  ", notes: [] }), text);
});

t("CRLF 文本换行符保持不变", () => {
  const text = "# 甲\r\n\r\n# 乙\r\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const next = insertChildNode(text, o.root, { title: "丙", notes: ["备注"] });
  assert.ok(next.includes("\r\n"));
  assert.ok(!/(^|[^\r])\n/.test(next), "不应出现裸 LF");
});

t("frontmatter 存在时新增节点不污染 frontmatter", () => {
  const text = "---\nmandala: true\n---\n\n# 甲\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const next = insertChildNode(text, o.root, { title: "乙", notes: [] });
  assert.ok(next.startsWith("---\nmandala: true\n---"));
  const o2 = parseOutline(next, { fileTitle: "x" });
  assert.deepStrictEqual(o2.root.children.map((n) => n.title), ["甲", "乙"]);
});

console.log("=== v1.2.0 方位 / 排序方向 ===");

t("buildSlots 默认（正上方 + 顺时针）= SLOT_POS", () => {
  assert.deepStrictEqual(buildSlots("top", "cw"), SLOT_POS);
  assert.deepStrictEqual(RING_CW, SLOT_POS);
});

t("RING_CCW 同起点逆时针", () => {
  assert.deepStrictEqual(RING_CCW[0], [0, 1]);
  assert.deepStrictEqual(RING_CCW[1], [0, 0]);
  assert.deepStrictEqual(RING_CCW[7], [0, 2]);
});

t("buildSlots：左上起顺时针 / 正上方起逆时针", () => {
  assert.deepStrictEqual(buildSlots("top-left", "cw")[0], [0, 0]);
  assert.deepStrictEqual(buildSlots("top-left", "cw")[1], [0, 1]);
  assert.deepStrictEqual(buildSlots("top", "ccw")[0], [0, 1]);
  assert.deepStrictEqual(buildSlots("top", "ccw")[1], [0, 0]);
  assert.deepStrictEqual(buildSlots("bottom-right", "cw")[0], [2, 2]);
});

t("8 方位 × 2 方向：格位均不重复且不含中心", () => {
  for (const first of FIRST_SLOT_ORDER) {
    for (const dir of ["cw", "ccw"]) {
      const s = buildSlots(first, dir);
      assert.strictEqual(s.length, PAGE_SIZE);
      const keys = s.map((p) => p.join(","));
      assert.strictEqual(new Set(keys).size, 8, `${first}/${dir} 有重复格位`);
      assert.ok(!keys.includes("1,1"), "中心格不能被占用");
    }
  }
});

console.log("=== v1.2.0 层级编号 ===");

t("childNumber：一级 / 二级 / 三级", () => {
  assert.strictEqual(childNumber("", 1), "1");
  assert.strictEqual(childNumber("", 3), "3");
  assert.strictEqual(childNumber("1", 1), "1.1");
  assert.strictEqual(childNumber("1", 3), "1.3");
  assert.strictEqual(childNumber("1.1", 2), "1.1.2");
});

t("超过 3 层压缩为「首段...末两段」1...1.1", () => {
  assert.strictEqual(childNumber("1.1.1", 1), "1...1.1");
  assert.strictEqual(compactNumber("1.1.1.1"), "1...1.1");
  assert.strictEqual(compactNumber("1.1.1.4"), "1...1.4");
  assert.strictEqual(compactNumber("2.3.4.5"), "2...4.5");
  assert.strictEqual(compactNumber("1.1.1"), "1.1.1");
  assert.strictEqual(compactNumber(""), "");
});

t("翻页编号连续（第 2 页不重置）", () => {
  assert.strictEqual(childNumber("", 9), "9");
  assert.strictEqual(childNumber("1", 9), "1.9");
  assert.strictEqual(childNumber("1", 10), "1.10");
});

console.log("=== v1.2.0 拖拽顺序换算 ===");

t("moveIndices / dropFinalAt 前后插入位置正确", () => {
  assert.deepStrictEqual(moveIndices(4, 0, 1), [1, 0, 2, 3]);
  assert.deepStrictEqual(moveIndices(4, 3, 1), [0, 3, 1, 2]);
  assert.strictEqual(dropFinalAt(0, 1, true), 1);
  assert.strictEqual(dropFinalAt(3, 1, false), 1);
  assert.strictEqual(dropFinalAt(0, 1, false), 0);
});

console.log("=== v1.2.0 section 边界与同级重排 ===");

t("sectionEndLine：下一同级/更高级标题结束，代码块内假标题跳过", () => {
  const lines = ["# 甲", "```md", "# 假", "```", "## 甲1", "# 乙"].join("\n").split("\n");
  assert.strictEqual(sectionEndLine(lines, 0, 1), 5);
  assert.strictEqual(sectionEndLine(lines, 0, 0), lines.length);
  assert.strictEqual(sectionEndLine(lines, 4, 2), 5);
});

t("reorderChildren：交换两个一级节点，子树与备注一起搬走", () => {
  const text = [
    "# 甲", "甲备注", "",
    "## 甲1", "甲1备注", "",
    "# 乙", "",
    "## 乙1", "",
  ].join("\n");
  const o = parseOutline(text, { fileTitle: "x" });
  assert.deepStrictEqual(o.root.children.map((n) => n.title), ["甲", "乙"]);
  const next = reorderChildren(text, o.root, [1, 0]);
  const o2 = parseOutline(next, { fileTitle: "x" });
  assert.deepStrictEqual(o2.root.children.map((n) => n.title), ["乙", "甲"]);
  assert.ok(o2.root.children[1].notes.includes("甲备注"));
  assert.deepStrictEqual(o2.root.children[1].children.map((n) => n.title), ["甲1"]);
  assert.ok(o2.root.children[1].children[0].notes.includes("甲1备注"));
  assert.deepStrictEqual(o2.root.children[0].children.map((n) => n.title), ["乙1"]);
});

t("reorderChildren：在 H1 内部重排 H2，不影响兄弟 H1", () => {
  const text = [
    "# 甲", "", "## 甲1", "", "## 甲2", "", "## 甲3", "",
    "# 乙", "", "## 乙1", "",
  ].join("\n");
  const o = parseOutline(text, { fileTitle: "x" });
  const h1 = o.root.children[0];
  const next = reorderChildren(text, h1, [2, 0, 1]);
  const o2 = parseOutline(next, { fileTitle: "x" });
  assert.deepStrictEqual(
    o2.root.children[0].children.map((n) => n.title),
    ["甲3", "甲1", "甲2"]
  );
  assert.deepStrictEqual(o2.root.children[1].title, "乙");
  assert.deepStrictEqual(o2.root.children[1].children.map((n) => n.title), ["乙1"]);
});

t("reorderChildren：frontmatter 与文件末尾内容保持不变", () => {
  const text = ["---", "mandala: true", "---", "", "# 甲", "", "# 乙", "", "尾部正文"].join("\n");
  const o = parseOutline(text, { fileTitle: "x" });
  const next = reorderChildren(text, o.root, [1, 0]);
  assert.ok(next.startsWith("---\nmandala: true\n---\n\n"));
  assert.ok(next.includes("尾部正文"));
  assert.deepStrictEqual(
    parseOutline(next, { fileTitle: "x" }).root.children.map((n) => n.title),
    ["乙", "甲"]
  );
});

t("reorderChildren：代码块内假标题不切开 section", () => {
  const text = ["# 甲", "", "```md", "# 假标题", "```", "", "## 甲1", "", "# 乙", ""].join("\n");
  const o = parseOutline(text, { fileTitle: "x" });
  const next = reorderChildren(text, o.root, [1, 0]);
  assert.ok(next.includes("```md\n# 假标题\n```"));
  const o2 = parseOutline(next, { fileTitle: "x" });
  assert.deepStrictEqual(o2.root.children.map((n) => n.title), ["乙", "甲"]);
  assert.deepStrictEqual(o2.root.children[1].children.map((n) => n.title), ["甲1"]);
});

t("reorderChildren 保留 CRLF", () => {
  const text = "# 甲\r\n\r\n# 乙\r\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const next = reorderChildren(text, o.root, [1, 0]);
  assert.ok(next.includes("\r\n"));
  assert.ok(!/(^|[^\r])\n/.test(next), "不应出现裸 LF");
});

t("reorderChildren：恒等 / 非法 order 不改文本", () => {
  const text = "# 甲\n\n# 乙\n";
  const o = parseOutline(text, { fileTitle: "x" });
  assert.strictEqual(reorderChildren(text, o.root, [0, 1]), text);
  assert.strictEqual(reorderChildren(text, o.root, [0, 0]), text);
  assert.strictEqual(reorderChildren(text, o.root, [0]), text);
  assert.strictEqual(reorderChildren(text, o.root, [0, 9]), text);
});

console.log("=== v1.3.0 光标跟随：定位与祖先链 ===");

t("findNodeAtLine：标题 / 备注 / 空行 / frontmatter / 越界", () => {
  const text = [
    "---", "mandala: true", "---", "",  // 0-3
    "# 一级A",                          // 4
    "A 的备注",                         // 5
    "",                                 // 6
    "## 二级A1",                        // 7
    "A1 备注",                          // 8
    "",                                 // 9
    "## 二级A2",                        // 10
    "",                                 // 11
    "# 一级B",                          // 12
  ].join("\n");
  const o = parseOutline(text, { fileTitle: "x" });
  assert.strictEqual(findNodeAtLine(o.root, 0).line, 0, "frontmatter -> root");
  assert.strictEqual(findNodeAtLine(o.root, 3).line, 0);
  assert.strictEqual(findNodeAtLine(o.root, 4).title, "一级A");
  assert.strictEqual(findNodeAtLine(o.root, 5).title, "一级A", "备注行归属一级A");
  assert.strictEqual(findNodeAtLine(o.root, 6).title, "一级A", "空行归属一级A");
  assert.strictEqual(findNodeAtLine(o.root, 7).title, "二级A1");
  assert.strictEqual(findNodeAtLine(o.root, 9).title, "二级A1");
  assert.strictEqual(findNodeAtLine(o.root, 11).title, "二级A2");
  assert.strictEqual(findNodeAtLine(o.root, 999).title, "一级B");
  assert.strictEqual(findNodeAtLine(o.root, -5).line, 0);
});

t("findNodeAtLine：空笔记回退到 root", () => {
  const o = parseOutline("普通正文\n", { fileTitle: "空" });
  assert.strictEqual(findNodeAtLine(o.root, 0), o.root);
  assert.strictEqual(findNodeAtLine(o.root, 50), o.root);
});

t("nodePath 返回 root → 节点的祖先链", () => {
  const o = parseOutline("# 甲\n## 甲1\n### 甲1a\n", { fileTitle: "x" });
  const leaf = o.root.children[0].children[0].children[0];
  assert.deepStrictEqual(nodePath(leaf).map((n) => n.title), ["x", "甲", "甲1", "甲1a"]);
  assert.deepStrictEqual(nodePath(o.root).map((n) => n.title), ["x"]);
});

console.log("=== v1.3.0 编辑已有节点：写回 Markdown ===");

t("updateNode：改标题保留 # 级别与 %%标记%% / 块 id", () => {
  const text = "# 一级A %%teal%% ^ab12\n\n## 子A1\n\n# 一级B\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const next = updateNode(text, o.root.children[0], {
    title: "一级A改", notes: o.root.children[0].notes,
  });
  assert.ok(next.startsWith("# 一级A改 %%teal%% ^ab12"));
  const o2 = parseOutline(next, { fileTitle: "x" });
  assert.deepStrictEqual(o2.root.children.map((n) => n.title), ["一级A改", "一级B"]);
  assert.deepStrictEqual(o2.root.children[0].children.map((n) => n.title), ["子A1"]);
});

t("updateNode：只改备注时标题行原样保留（含 wikilink）", () => {
  const text = "# [[目标|别名]] %%red%%\n> 旧备注\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const a = o.root.children[0];
  const next = updateNode(text, a, { title: a.title, notes: ["新备注"] });
  assert.ok(next.startsWith("# [[目标|别名]] %%red%%"));
  assert.ok(next.includes("> 新备注"));
  assert.ok(!next.includes("旧备注"));
  assert.strictEqual(parseOutline(next, { fileTitle: "x" }).root.children[0].notes[0], "新备注");
});

t("updateNode：备注替换不破坏子树、兄弟节点与 frontmatter", () => {
  const text = [
    "---", "mandala: true", "---", "",
    "# 甲", "旧备注一", "旧备注二", "",
    "## 甲1", "甲1备注", "",
    "# 乙", "乙备注", "",
  ].join("\n");
  const o = parseOutline(text, { fileTitle: "x" });
  const next = updateNode(text, o.root.children[0], {
    title: "甲改", notes: ["新备注一", "新备注二"],
  });
  assert.ok(next.startsWith("---\nmandala: true\n---"));
  assert.ok(!next.includes("旧备注"));
  const o2 = parseOutline(next, { fileTitle: "x" });
  assert.deepStrictEqual(o2.root.children.map((n) => n.title), ["甲改", "乙"]);
  assert.deepStrictEqual(o2.root.children[0].notes, ["新备注一", "新备注二"]);
  assert.ok(o2.root.children[0].children[0].notes.includes("甲1备注"));
  assert.ok(o2.root.children[1].notes.includes("乙备注"));
});

t("updateNode：围栏代码块与水平线不被当作备注删除", () => {
  const text = ["# 甲", "", "```md", "# 假标题", "随便正文", "```", "---", "", "## 甲1", ""].join("\n");
  const o = parseOutline(text, { fileTitle: "x" });
  const next = updateNode(text, o.root.children[0], { title: "甲", notes: ["新备注"] });
  assert.ok(next.includes("```md\n# 假标题\n随便正文\n```"));
  assert.ok(next.includes("\n---\n"), "水平线应保留");
  assert.ok(next.includes("> 新备注"));
  assert.deepStrictEqual(
    parseOutline(next, { fileTitle: "x" }).root.children[0].children.map((n) => n.title),
    ["甲1"]
  );
});

t("updateNode：清空备注只删备注行，结构行不动", () => {
  const text = "# 甲\n> 备注一\n> 备注二\n\n## 甲1\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const next = updateNode(text, o.root.children[0], { title: "甲", notes: [] });
  assert.ok(!next.includes("备注"));
  assert.ok(next.includes("## 甲1"));
  assert.strictEqual(parseOutline(next, { fileTitle: "x" }).root.children[0].notes.length, 0);
});

t("updateNode：列表节点保留缩进与项目符号", () => {
  const text = "# 中心\n\n\t- 子项\n\t\t旧备注\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const item = o.root.children[0].children[0];
  const next = updateNode(text, item, { title: "子项改", notes: ["新备注"] });
  assert.ok(next.includes("\t- 子项改"));
  assert.ok(next.includes("\t\t> 新备注"), "列表节点备注应比节点多缩进一层");
  const o2 = parseOutline(next, { fileTitle: "x" });
  assert.strictEqual(o2.root.children[0].children[0].title, "子项改");
  assert.ok(o2.root.children[0].children[0].notes.includes("新备注"));
});

t("updateNode：paragraph 风格危险前缀被保护", () => {
  const text = "# 甲\n> 旧备注\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const next = updateNode(text, o.root.children[0], {
    title: "甲", notes: ["# 看起来像标题", "- 看起来像列表"],
  }, "paragraph");
  const o2 = parseOutline(next, { fileTitle: "x" });
  assert.deepStrictEqual(o2.root.children.map((n) => n.title), ["甲"]);
  assert.ok(o2.root.children[0].notes.some((s) => s.includes("看起来像标题")));
  assert.ok(o2.root.children[0].notes.some((s) => s.includes("看起来像列表")));
});

t("updateNode 保留 CRLF", () => {
  const text = "# 甲\r\n> 旧备注\r\n\r\n# 乙\r\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const next = updateNode(text, o.root.children[0], { title: "甲改", notes: ["新备注"] });
  assert.ok(next.includes("\r\n"));
  assert.ok(!/(^|[^\r])\n/.test(next), "不应出现裸 LF");
});

t("updateNode：内容无变化时返回原文（可避免无意义写盘）", () => {
  const text = "# 甲\n> 备注\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const a = o.root.children[0];
  assert.strictEqual(updateNode(text, a, { title: a.title, notes: a.notes }), text);
});

t("updateNode：根节点 / 空标题 / 行不匹配时返回原文", () => {
  const text = "# 甲\n> 备注\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const a = o.root.children[0];
  assert.strictEqual(updateNode(text, o.root, { title: "改", notes: [] }), text);
  assert.strictEqual(updateNode(text, a, { title: "  ", notes: [] }), text);
  const savedLine = a.line;
  a.line = 99;
  assert.strictEqual(updateNode(text, a, { title: "改", notes: [] }), text, "行号越界应拒绝");
  a.line = savedLine;
  const savedRaw = a.raw;
  a.raw = "完全不同的标题";
  assert.strictEqual(updateNode(text, a, { title: "改", notes: [] }), text, "陈旧 outline 应拒绝");
  a.raw = savedRaw;
});

console.log("\n=== v1.3.1 引用块备注缩进（不打断下级列表）===");

t("insertChildNode：列表节点备注缩进一层，不出现顶格引用块", () => {
  const text = "# 中心\n\n- A\n\t- A1\n\n- B\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const next = insertChildNode(text, o.root.children[0], { title: "C", notes: ["C备注"] });
  assert.ok(next.includes("\n\t> C备注"), "列表子节点备注应为 Tab + > ：\n" + next);
  assert.ok(!/^> /m.test(next), "不应出现会打断列表的顶格引用块");
  const o2 = parseOutline(next, { fileTitle: "x" });
  assert.deepStrictEqual(o2.root.children[0].children.map((n) => n.title), ["A", "B", "C"]);
  assert.ok(o2.root.children[0].children[2].notes.includes("C备注"));
});

t("insertChildNode：标题节点备注保持顶格（不受影响）", () => {
  const text = "# 甲\n\n## 甲1\n\n# 乙\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const next = insertChildNode(text, o.root, { title: "丙", notes: ["丙的备注"] });
  assert.ok(next.includes("\n> 丙的备注"), "标题节点备注应保持顶格");
  assert.ok(!next.includes("\t> 丙的备注"));
});

t("updateNode：顶格列表节点的旧顶格引用块改写为缩进一层", () => {
  const text =
    "### 段\n- 大段非标为备注\n> 旧备注一\n> 旧备注二\n" +
    "\t- 6级md标题\n\t\t尚未发现排除设置\n\t- 序号、无序大纲\n";
  const o = parseOutline(text, { fileTitle: "x" });
  let hit = null;
  const walk = (n) => { if (hit) return; if (n.title === "大段非标为备注") { hit = n; return; } n.children.forEach(walk); };
  walk(o.root);
  assert.ok(hit, "应解析出父节点");
  const next = updateNode(text, hit, { title: "大段非标为备注", notes: ["新备注一", "新备注二"] });
  assert.ok(!/^> /m.test(next), "顶格引用块应被消除：\n" + next);
  assert.ok(next.includes("\t> 新备注一") && next.includes("\t> 新备注二"));
  assert.ok(next.indexOf("\t> 新备注二") < next.indexOf("\t- 6级md标题"), "备注仍在子节点之前");
  const o2 = parseOutline(next, { fileTitle: "x" });
  let p2 = null;
  const walk2 = (n) => { if (p2) return; if (n.title === "大段非标为备注") { p2 = n; return; } n.children.forEach(walk2); };
  walk2(o2.root);
  assert.deepStrictEqual(p2.children.map((c) => c.title), ["6级md标题", "序号、无序大纲"]);
  assert.deepStrictEqual(p2.notes, ["新备注一", "新备注二"]);
});

t("updateNode：标题节点备注保持顶格", () => {
  const text = "# 甲\n> 旧备注\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const next = updateNode(text, o.root.children[0], { title: "甲", notes: ["新备注"] });
  assert.ok(next.includes("> 新备注") && !next.includes("\t> 新备注"));
});

t("paragraph 备注同样缩进一层，且子节点层级不变", () => {
  const text = "### 段\n- 父\n\t- 子\n";
  const o = parseOutline(text, { fileTitle: "x" });
  const parent = o.root.children[0].children[0];
  const next = updateNode(text, parent, { title: "父", notes: ["普通备注"] }, "paragraph");
  assert.ok(next.includes("\n\t普通备注"), "列表节点段落备注应缩进一层：\n" + next);
  const o2 = parseOutline(next, { fileTitle: "x" });
  assert.ok(o2.root.children[0].children[0].notes.includes("普通备注"));
  assert.strictEqual(o2.root.children[0].children[0].children[0].title, "子");
});

// The note was renamed to "gogo+九宫.md" on 2026-11-12; accept both names
// so the real-note regression never silently disappears again.
const REAL2 = [
  "E:/OObsidian/0新建未分类/gogo+九宫.md",
  "E:/OObsidian/0新建未分类/gogo九宫.md",
].find((p) => fs.existsSync(p));
if (REAL2) {
  const text2 = fs.readFileSync(REAL2, "utf-8");
  t("真实笔记 gogo九宫：引用块备注已缩进，下级无序列表仍是子节点", () => {
    const o = parseOutline(text2, { fileTitle: "gogo九宫" });
    let hit = null;
    const walk = (n) => { if (hit) return; if (n.title === "大段非标为备注") { hit = n; return; } n.children.forEach(walk); };
    walk(o.root);
    assert.ok(hit, "应能解析出「大段非标为备注」节点");
    assert.deepStrictEqual(hit.children.map((c) => c.title), ["6级md标题", "序号、无序大纲"]);
    assert.ok(hit.notes.some((s) => s.includes("元会运世")), "缩进的引用块仍被采集为备注");
    const lines = text2.split(/\r?\n/);
    const a = lines.findIndex((l) => /^\s*- 大段非标为备注(?:\s|$)/.test(l));
    const b = lines.findIndex((l, i) => i > a && /^\s*- 改调统一，实时显示(?:\s|$)/.test(l));
    assert.ok(a >= 0 && b > a, "应能定位问题段");
    assert.ok(!lines.slice(a, b).some((l) => /^> /.test(l)), "问题段不应残留顶格 > 行");
    assert.ok(lines.slice(a, b).some((l) => /^\t> /.test(l)), "问题段应有 Tab 缩进的引用块");
  });
}

console.log("\n=== " + pass + " passed" + (process.exitCode ? " (with failures)" : "") + " ===");
