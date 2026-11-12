/**
 * Build 9go into the Obsidian plugins folder.
 * Usage: node build.js            (defaults to E:/OObsidian/.obsidian/plugins/9go)
 *        NINEGO_OUT=<dir> node build.js
 */
const fs = require("fs");
const path = require("path");

function loadEsbuild() {
  const candidates = [
    "esbuild",
    "C:/Users/86159/.workbuddy/binaries/node/workspace/node_modules/esbuild",
    process.env.ESBUILD_PATH,
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      return require(c);
    } catch (_e) {
      /* try next */
    }
  }
  console.error("ERROR: esbuild not found. Set ESBUILD_PATH to an esbuild install.");
  process.exit(1);
}

const esbuild = loadEsbuild();
const SRC = __dirname;
const OUT = process.env.NINEGO_OUT || "E:/OObsidian/.obsidian/plugins/9go";
fs.mkdirSync(OUT, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(SRC, "main.ts")],
  outfile: path.join(OUT, "main.js"),
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2018",
  charset: "utf8", // keep Chinese literals readable (default ascii escapes them)
  external: ["obsidian"],
  legalComments: "none",
});

for (const f of ["manifest.json", "styles.css"]) {
  fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
}

// also emit a CommonJS bundle of the pure core (parser + layout) for tests
esbuild.buildSync({
  entryPoints: [path.join(SRC, "core.ts")],
  outfile: path.join(SRC, ".core-test-bundle.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2018",
  charset: "utf8",
});

const size = fs.statSync(path.join(OUT, "main.js")).size;
console.log("BUILD OK -> " + OUT);
console.log("  main.js      : " + size + " bytes");
console.log("  manifest.json / styles.css : copied");
console.log("  core test bundle           : .core-test-bundle.cjs");
