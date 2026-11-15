# 9go — Mandala (3×3) view for Obsidian

> English documentation. 中文说明见 [README.md](README.md) · 中文更新日志见 [CHANGELOG.md](CHANGELOG.md) · English changelog: [CHANGELOG.en.md](CHANGELOG.en.md)

9go turns any Markdown outline into a **3×3 Mandala grid**: the centre is the current node and the eight surrounding cells are its children. Creating, editing, reordering and locating nodes all write plain Markdown back into your note — no private file format.

- Syntax and interaction follow **[gogoga-mindmap](https://github.com/JackWeiGogoga/gogoga-mindmap)**, but this is an **independent implementation** of the same data model. Both plugins can be enabled at once (all view/command ids use the `9go-` prefix).
- Current version **1.3.2** (`minAppVersion` 1.8.7). Requires Obsidian ≥ 1.8.7.
- License: 0BSD.

---

## Install

**Manual:** download `main.js`, `manifest.json` and `styles.css` from [Releases](https://github.com/greatooo/9go/releases), put them in `<vault>/.obsidian/plugins/9go/`, then fully restart Obsidian and enable **9go** under Settings → Community plugins. Upgrading only overwrites those three files; your settings (`data.json`) are preserved.

**BRAT:** add the repository `greatooo/9go` in [BRAT](https://github.com/TfTHacker/obsidian42-brat) to follow releases automatically.

---

## How the grid is arranged

```
        [8] [1] [2]        1.1  1.2  1.3
        [7] [C] [3]   →    1.4   C   1.5
        [6] [5] [4]        1.6  1.7  1.8
```

- **Centre cell** = the current centre node (the note filename by default, or the first level-1 heading). Shows title, notes and “Back”.
- **8 surrounding cells** = the centre's direct children, starting at the **top** and filling **clockwise** by default. Both the first slot (8 positions) and the direction are configurable; the outline numbers move with them.
- **Level mapping**: note title → `# H1` (ring) → click “N children” to drill into an H1 → `## H2` becomes the ring → and so on; list items become deeper levels.
- Numbering follows heading levels: `1` / `1.1` / `1.1.1`; beyond 3 levels it compacts to `1...1.1`. Numbers are global across pages.
- Notes are hidden by default; enable them globally or use the `⌄` button in each cell. The centre cell follows the global setting (since 1.3.1).

### Interaction map

| Action | Result |
|---|---|
| Double-click an empty cell | Create a child node (title + notes) |
| Double-click a filled cell / ✎ | Edit that node's title and notes |
| Double-click a leaf's title | Centre the grid on that leaf |
| Click “N children” | Drill down one level |
| Single-click a blank area | Locate the line in the split Markdown view and flash a highlight |
| Drag between two siblings | Reorder siblings (whole subtree is rewritten) |
| Drag onto the centre cell | Promote the node one level |

---

## Image thumbnails & editable image notes (1.3.2)

**Thumbnails.** Images found in a node's title or notes render as thumbnails inside the grid cell. Three sources are supported:

| Source | Example |
|---|---|
| External URL | `![Engelbart\|200](https://host/x.png)` |
| Vault attachment | `![[attachments/x.png\|200]]` |
| Block reference | `[[note#^block-id]]` (first image inside that block, resolved asynchronously) |

Settings: **Show image thumbnails** (on by default) and **Max thumbnail height** (px, 32–320, default 96; 64 on mobile). At most 3 images per cell; broken images hide themselves. Turn the toggle off to fall back to the original plain-text note preview.

**Editable raw notes.** Since 1.3.2, the edit dialog shows the *raw* note lines, so `![alt](url)`, `![[x.png|200]]`, `[[note#^block-id]]`, trailing `^block-id` and `%%markers%%` are visible and can be edited, replaced or deleted. Writing back keeps the `> ` blockquote syntax (list nodes are indented one extra level).

Why this matters: a note line containing only an image used to produce an empty notes box; saving without any change would silently **delete the image line** from the Markdown file. `updateNode()` now compares the textarea against the raw notes and, when unchanged, skips note rewriting entirely — images, block ids, tables, callout headers and CRLF endings stay byte-for-byte intact. Command-palette names are registered at load time; after changing the language, reload the plugin to refresh those names.

---

## Interface language (1.3.2)

Settings → **Interface language**: `中文` / `English` / `Follow Obsidian`.

- Default is **中文**, so upgrading never changes existing behaviour.
- `Follow Obsidian` reads Obsidian's UI locale (`moment.locale()`, then `<html lang>`); unknown locales fall back to Chinese.
- The grid, dialogs, notices, command names and the whole settings tab are translated. The settings tab and all open Mandala views repaint immediately; command-palette names update after reloading the plugin.
- All strings live in one `i18n.ts` table where every key holds both `zh` and `en`, so the two languages cannot drift apart. `zh` values are byte-identical to the 1.3.1 Chinese strings.

---

## Trigger & note syntax

| Trigger | Example |
|---|---|
| frontmatter | `mandala: true` or `mindmap-structure: mandala` |
| inline marker | `%%mandala%%` |
| embedded block | a ` ```mandala ` fenced block with the same Markdown outline |

Notes use the gogoga convention: a paragraph following a node belongs to that node. For **list nodes**, notes must be indented one level deeper than the item (e.g. `\t> `). A flush-left `> ` right after a list item terminates the CommonMark list and turns following Tab-indented `- ` children into literal text in Reading view.

---

## Settings (English labels)

| Setting | Default | Notes |
|---|---|---|
| Interface language | 中文 | 中文 / English / Follow Obsidian |
| Trigger keywords | `mandala` | Comma separated; matches frontmatter keys/values and `%%markers%%` |
| Auto-open tagged notes | on | Once per file per session |
| Show notes by default | off | Includes the centre cell since 1.3.1 |
| Max note length | 120 | Truncated with `…` |
| Show image thumbnails | on | External URLs, vault attachments, block references |
| Max thumbnail height | 96 px | 32–320, max 3 images per cell |
| Centre title source | Note title (filename) | Or the first level-1 heading |
| Auto-collapse single root | off | Centre on the only H1 |
| Embedded grid height | 460 px | Height of ` ```mandala ` blocks |
| New node · note syntax | `> ` blockquote | Or plain paragraphs |
| Single-click locates in Markdown | on | Flash highlight, then fade |
| Highlight duration | 1400 ms | 300–10000, then ~220 ms fade |
| When no split Markdown view | Auto-split | Auto-split / new tab / do nothing |
| Position of the first child | Top | 8 positions |
| Child ordering direction | Clockwise | Clockwise / counter-clockwise |
| Show slot coordinate labels | off | Fixed 1.1–1.8 in the top-right |
| Drag to reorder siblings | on | Dropping on the centre promotes a node |
| Follow cursor | off | 250 ms polling of the active Markdown view |
| When the caret node has no children | Fall back to parent | Or keep the leaf as centre |

---

## Build & test

```bash
node build.js          # bundles main.ts -> .obsidian/plugins/9go/main.js
                       # also emits .core-test-bundle.cjs for Node harnesses
node test_core.cjs && node test_grid.cjs && node test_real_note.cjs
node test_images.cjs && node test_edit_notes.cjs && node test_i18n.cjs
```

The build uses esbuild (`--bundle --platform=browser --format=cjs --target=es2018 --external:obsidian --charset=utf8`). Six harnesses total **215 checks** (81 / 70 / 10 / 19 / 21 / 14). `main.js` is a build artifact: it is a Release asset only, never committed to the repository.

---

## Known limitations

- Notes are displayed as plain text; images are the only rendered exception. Wikilinks show their alias and are not clickable. HTML is not parsed and no script is executed; block references read only the first image in the target block and never recurse.
- Editing a node rewrites its note lines to the configured syntax. Lines you did not touch are preserved byte-for-byte; if you *do* edit notes, tables / HTML comments inside the note area are rewritten too. For byte-exact formatting, edit the Markdown directly.
- The centre root (the note title) has no Markdown line, so it cannot be edited from the grid — rename the file or the first heading instead.
- Click-to-locate depends on CodeMirror's `.cm-line`; in Reading mode or under third-party editor themes it falls back to matching the title text.
- After inserting/deleting lines elsewhere, drill-down restoration may fall back to the deepest matching level.

---

## Credits & license

Outline syntax and interaction reference: [JackWeiGogoga/gogoga-mindmap](https://github.com/JackWeiGogoga/gogoga-mindmap). 9go is an independent implementation and is released under the **0BSD** license (see `LICENSE`).
