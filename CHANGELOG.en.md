# Changelog (English)

Versions match `manifest.json`; every release has a GitHub Release with a tag such as `v1.3.3`.
中文版：[CHANGELOG.md](CHANGELOG.md)

## 1.3.3 — 2026-11-15

**Note toggle flips both ways; click a thumbnail to enlarge it.**

### Note toggle really flips both ways

- The old `Set<string>` could only record "force open", and visibility was computed as `expanded.has(key) || showNotes`. With **Show notes** ON the result was always `true`, so pressing the cell button did nothing; with it OFF the override was still one-directional.
- Replaced by a `Map<string, boolean>` tri-state: no entry follows the setting; explicit `true` / `false` overrides it. Each click writes `!current`, so open ↔ closed alternates reliably under either setting, with the arrow and tooltip following suit.
- Manual overrides survive `renderFile()` grid rebuilds via `getNoteOverrides()` / `applyNoteOverrides()`. Paging, going back up and drilling down still clear them so states never leak between levels.

### Click a thumbnail to enlarge it

- Thumbnails were only added to the interactive whitelist to avoid locating / editing, but **no click listener was ever attached**, and CSS said `cursor: default`.
- Clicking a thumbnail now opens a full-size preview dialog. `‹` / `›` or the arrow keys cycle through the images in that cell, a "i of n" counter and the raw image syntax are shown, and clicking outside / ✕ / Esc closes it. A broken image never opens an empty preview. The cursor is now a zoom-in pointer.
- The preview is wired through `GridOptions.onPreviewImage`, shared by the full view and embedded ` ```mandala ` blocks. Clicking still never triggers single-click locating or double-click editing.

### Regression

- Seven harnesses, **239 checks**: `test_core` 81 / `test_grid` 70 / `test_real_note` 10 / `test_images` 19 / `test_edit_notes` 21 / `test_i18n` 14 / `test_interactions` 24 — all passing.
- `node --check` and a real esbuild bundle pass. `tsc` is not installed on this machine; type checking is substituted by the bundle plus the 239 checks.

> **Version note**: these two interaction fixes first shipped as local-only post-`v1.3.2` patches (the manifest briefly stayed at 1.3.2). To make them available to BRAT / community-plugin users, this release bumps the manifest to **1.3.3** and publishes `v1.3.3`; the Release `main.js` is byte-identical to the locally deployed build. `v1.3.2` was published on 2026-11-15 at 17:18 (release 445937371) and its assets do not contain these fixes.

## 1.3.2 — 2026-11-15

**Image thumbnails, lossless note editing, and a bilingual UI.**

### Image previews (new)

- Grid cells now render thumbnails for images found in a node's title or notes. Three sources are supported: external URLs `![alt|200](https://…)`, vault attachments `![[x.png|200]]`, and block references `[[note#^block-id]]` (the first image in that block, resolved asynchronously and never recursively).
- New settings: **Show image thumbnails** (on by default) and **Max thumbnail height** (32–320 px, default 96; 64 on mobile). At most 3 images per cell; broken images hide themselves; clicking an image never triggers single-click locating or double-click editing.
- Turning the toggle off restores the 1.3.1 plain-text note preview — no text disappears. The full view and embedded ` ```mandala ` blocks share the same resolver callbacks.
- Root cause fixed: `cleanNote()` used to wash `[alt](url)` into `alt`, so the URL was lost during parsing. Images are now extracted from the **raw line** before the plain-text preview is cleaned.

### Image links are part of the editable note object (patch)

- The edit dialog used to show the *cleaned* text preview. A note line containing only an image produced an empty notes box, and — worse — clicking “Save changes” without editing anything **deleted that image line from the Markdown file** (including its trailing `^block-id`).
- The notes box now shows the **raw syntax**: `![alt](url)`, `![[image.png]]`, `[[note#^block-id]]`, trailing block ids and `%%markers%%` are all visible and can be rewritten, replaced or removed.
- `updateNode()` gained a **no-op protection**: the textarea is compared line-by-line with the raw notes, and when unchanged the note block is skipped entirely — images, tables, callout headers, markers and CRLF endings stay byte-for-byte intact. Only the title is rewritten when needed.
- When notes *are* edited, adding text, changing an image URL and deleting an image line all write back correctly as `\t> ` blockquotes, and the thumbnail can be extracted again.
- Real sample: for the “图片链接放到备注里” node in `gogo+九宫.md`, a no-op save leaves the whole file byte-identical; changing only the URL changes exactly 1 line.

### Interface language (new)

- New setting **Interface language**: `中文` / `English` / `Follow Obsidian`. Default is Chinese, so upgrading never changes existing behaviour.
- The grid, edit dialog, notices, command names and the whole settings tab are bilingual. Views and the settings tab repaint immediately; command-palette names refresh after reloading the plugin.
- All strings live in one `i18n.ts` table where every key holds both `zh` and `en`, so the languages cannot drift apart. Every `zh` value is byte-identical to the 1.3.1 Chinese string.

### Regression

- Six harnesses, **215 checks**: `test_core` 81 / `test_grid` 70 / `test_real_note` 10 / `test_images` 19 / `test_edit_notes` 21 / `test_i18n` 14 — all passing.
- `node --check` and a real esbuild bundle pass. `tsc` is not installed; type checking is substituted by the bundle plus the checks.

> 1.3.2 was bumped from 1.3.1 for image thumbnails; the note-editing fix and bilingual UI were enhancements within that version. **v1.3.2 was published to GitHub on 2026-11-15 at 17:18 (release 445937371)**; the two post-release interaction fixes are documented under 1.3.3.

## 1.3.1 — 2026-11-12

**First public release (tag `v1.3.1`).**

- Fixed: with “Show notes by default” on, the centre cell did not show its notes (it now follows the global setting; `⌄ / ⌃` can temporarily override it and drilling down resets it).
- Added: a “Reference & credits” section at the bottom of the settings tab that opens the gogoga-mindmap repository.
- Repo housekeeping: added `LICENSE`, `CHANGELOG`, `package.json`, `tsconfig.json`, `.gitignore` and `versions.json`.

## 1.3.0 — 2026-11-10 ~ 11

- Added “Follow cursor”: while editing Markdown in a split view, the caret node becomes the grid centre and is highlighted (250 ms polling of the active view).
- Added double-click editing of filled cells; fixed the highlight duration setting (300–10000 ms); fixed drill-down level restoration after a redraw.
- Interaction refinements: double-click a leaf to edit it; a permanent “More children” link in the last slot; drop on the centre to promote a node; list-node notes indent one extra level so they no longer break child lists.

## 1.2.0 — 2026-11-10

- Added: choose which of the 8 ring positions holds the first child, and clockwise / counter-clockwise ordering; cell numbers move with it.
- Added: outline numbers from Markdown heading levels — `1` / `1.1` / `1.1.1`, compacted to `1...1.1` beyond 3 levels.
- Added: drag a child between two siblings to insert it, rewriting the whole subtree in Markdown.

## 1.1.0 — 2026-11-10

- Added: double-click an empty cell to create a child node (title + notes) at the current level.
- Added: single-click a node to locate the matching line in the split Markdown view and flash a highlight that fades out.

## 1.0.0 — 2026-11-09

- First working version: 3×3 grid, pagination beyond 8 siblings, per-cell note collapsing, and embedded ` ```mandala ` code blocks.
