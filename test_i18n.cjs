/**
 * v1.3.2 · bilingual UI regression.
 * Run: node test_i18n.cjs   (requires a fresh build: node build.js)
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const core = require(path.join(__dirname, ".core-test-bundle.cjs"));
const {
  STRINGS, t, tr, setLanguage, currentLanguage, slotLabel, FIRST_SLOT_LABEL,
} = core;

const DIR = __dirname;
const MAIN_TS = path.join(DIR, "main.ts");
const MAIN_JS = path.join(DIR, "..", "..", ".obsidian", "plugins", "9go", "main.js");
const CN = /[\u4e00-\u9fff]/;

let pass = 0;
let fail = 0;
function tst(name, fn) {
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

// Language names / the language setting's own description legitimately
// contain Chinese characters even in the English copy.
const EN_CN_WHITELIST = new Set(["optLangZh", "setLanguageDesc"]);
const ZH_NONCN_WHITELIST = new Set(["optLangEn"]);
const SAME_WHITELIST = new Set(["optLangEn"]);

console.log("=== v1.3.2 · 字典完整性 ===");

tst("字典条目 ≥ 100，每条都有非空 zh / en", () => {
  const keys = Object.keys(STRINGS);
  assert.ok(keys.length >= 100, "条目数 " + keys.length);
  for (const k of keys) {
    assert.strictEqual(typeof STRINGS[k].zh, "string", k + ".zh");
    assert.strictEqual(typeof STRINGS[k].en, "string", k + ".en");
    assert.ok(STRINGS[k].zh.length > 0 && STRINGS[k].en.length > 0, k);
  }
});

tst("英文文案不含中文（语言名称等白名单除外）", () => {
  const bad = Object.keys(STRINGS).filter(
    (k) => CN.test(STRINGS[k].en) && !EN_CN_WHITELIST.has(k)
  );
  assert.deepStrictEqual(bad, [], "英文残留中文：" + bad.join(", "));
});

tst("中英两版确实不同（仅 English 选项同名）", () => {
  const bad = Object.keys(STRINGS).filter(
    (k) => STRINGS[k].zh === STRINGS[k].en && !SAME_WHITELIST.has(k)
  );
  assert.deepStrictEqual(bad, [], "未翻译：" + bad.join(", "));
});

tst("中文文案含中文（English 选项除外）", () => {
  const bad = Object.keys(STRINGS).filter(
    (k) => !CN.test(STRINGS[k].zh) && !ZH_NONCN_WHITELIST.has(k)
  );
  assert.deepStrictEqual(bad, [], "中文串异常：" + bad.join(", "));
});

console.log("=== v1.3.2 · t() / 语言切换 ===");

tst("默认 zh：中文文案逐字等于 1.3.1 原文", () => {
  setLanguage("zh");
  assert.strictEqual(currentLanguage(), "zh");
  assert.strictEqual(t("backUp"), "↑ 返回上级");
  assert.strictEqual(t("childrenN", { n: 2 }), "下级 2");
  assert.strictEqual(t("modalNotes"), "备注");
});

tst("setLanguage('en') 全量切换英文", () => {
  setLanguage("en");
  assert.strictEqual(currentLanguage(), "en");
  assert.strictEqual(t("backUp"), "↑ Back");
  assert.strictEqual(t("settingsTitle"), "9go · Mandala (3×3) view");
  assert.strictEqual(t("modalNotesPlaceholder").includes("image links"), true);
  setLanguage("zh");
});

tst("{n} / {title} 占位符替换，缺失变量保留原样", () => {
  assert.strictEqual(t("childCount", { n: 3 }), "3 个子节点");
  setLanguage("en");
  assert.strictEqual(t("childCount", { n: 3 }), "3 children");
  assert.strictEqual(t("noticeAdded", { title: "甲" }), "Added child node “甲”");
  assert.strictEqual(t("moreChildren", { from: 9 }), "More children (9–{to}) ›");
  setLanguage("zh");
});

tst("auto 在无 window/document 的 Node 环境安全回退 zh", () => {
  setLanguage("auto");
  assert.strictEqual(currentLanguage(), "zh");
  assert.strictEqual(t("cancel"), "取消");
});

tst("tr 是 t 的别名（避开 addText((t)) 参数遮蔽）", () => {
  assert.strictEqual(tr, t);
  assert.strictEqual(tr("cancel"), "取消");
});

tst("slotLabel 中英与 layout.FIRST_SLOT_LABEL 一致", () => {
  setLanguage("zh");
  assert.strictEqual(slotLabel("top"), FIRST_SLOT_LABEL.top);
  assert.strictEqual(slotLabel("bottom-left"), FIRST_SLOT_LABEL["bottom-left"]);
  setLanguage("en");
  assert.strictEqual(slotLabel("top"), "Top");
  assert.strictEqual(slotLabel("bottom-left"), "Bottom-left");
  setLanguage("zh");
});

console.log("=== v1.3.2 · 源码 / 产物契约 ===");

tst("main.ts 里所有 tr(\"key\") 都是字典里的合法 key", () => {
  const src = fs.readFileSync(MAIN_TS, "utf-8");
  const used = [...src.matchAll(/\btr\("([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
  assert.ok(used.length >= 100, "调用数 " + used.length);
  const bad = [...new Set(used)].filter((k) => !STRINGS[k]);
  assert.deepStrictEqual(bad, [], "未定义 key：" + bad.join(", "));
});

tst("main.ts 不再残留中文字符串字面量（注释除外）", () => {
  const lines = fs.readFileSync(MAIN_TS, "utf-8").split(/\r?\n/);
  const bad = [];
  lines.forEach((line, i) => {
    const s = line.trim();
    if (s.startsWith("//") || s.startsWith("*") || s.startsWith("/*")) return;
    const code = line.split("//")[0];
    const m = /"([^"\n]*[\u4e00-\u9fff][^"\n]*)"/.exec(code);
    if (m) bad.push((i + 1) + ": " + m[0].slice(0, 60));
  });
  assert.deepStrictEqual(bad, [], "残留：" + bad.join(" | "));
});

tst("main.ts 含语言设置、loadSettings/saveSettings 与即时刷新", () => {
  const src = fs.readFileSync(MAIN_TS, "utf-8");
  assert.ok(/language: Lang;/.test(src), "NineGoSettings 缺 language");
  assert.ok(/language: "zh"/.test(src), "默认值不是 zh");
  assert.ok(/setLanguage\(this\.settings\.language\);/g.test(src), "load/save 未同步语言");
  const hits = (src.match(/setLanguage\(this\.settings\.language\);/g) || []).length;
  assert.strictEqual(hits, 2, "应恰好 2 处（load + save）");
  assert.ok(/tr\("setLanguage"\)/.test(src) && /tr\("optLangAuto"\)/.test(src));
  assert.ok(/window\.setTimeout\(\(\) => this\.display\(\), 0\)/.test(src));
});

tst("部署的 main.js 同时含中英两套文案与语言下拉", () => {
  assert.ok(fs.existsSync(MAIN_JS), "请先跑 node build.js");
  const js = fs.readFileSync(MAIN_JS, "utf-8");
  ["↑ 返回上级", "↑ Back", "界面语言", "Interface language",
    "图片缩略图", "Image thumbnail", "More children", "更多子节点",
    "\"auto\"", "setLanguage"].forEach((s) => {
    assert.ok(js.includes(s), "产物缺少：" + s);
  });
});

console.log("=== " + pass + " passed / " + fail + " failed ===");
