/**
 * 9go / i18n.ts  —  v1.3.2 (bilingual UI)
 * ------------------------------------------------------------------
 * One table, two languages per entry: adding a key without both `zh` and
 * `en` is impossible, so the two dictionaries can never drift apart.
 *
 * `t()` reads a module-level language. `zh` is the default, which keeps
 * every existing harness (they assert Chinese labels) green without any
 * change. `auto` follows Obsidian's own locale via moment.locale().
 *
 * This module has ZERO Obsidian/DOM imports so `core.ts` can export it
 * for Node-side regression tests.
 */

export type Lang = "zh" | "en" | "auto";
export type ResolvedLang = "zh" | "en";
export type Vars = Record<string, string | number>;

export const STRINGS = {
  // ---------------------------------------------------------------- grid
  dropCenterHint: {
    zh: "拖动子节点到这里：上升一级，与中心节点同级",
    en: "Drop a child here to promote it one level (become a sibling of the centre)",
  },
  backUp: { zh: "↑ 返回上级", en: "↑ Back" },
  backUpAria: { zh: "返回上级九宫格", en: "Go to the parent grid" },
  untitled: { zh: "(未命名)", en: "(untitled)" },
  prevPage: { zh: "上一页", en: "Previous page" },
  nextPage: { zh: "下一页", en: "Next page" },
  childCount: { zh: "{n} 个子节点", en: "{n} children" },
  followCursorBadge: { zh: "⌖ 跟随光标", en: "⌖ Following cursor" },
  openNoteAria: { zh: "在 Markdown 中打开本笔记", en: "Open this note in Markdown" },
  centerTitleEditable: {
    zh: "{title}（双击编辑标题与备注）",
    en: "{title} (double-click to edit title and notes)",
  },
  editCenterAria: { zh: "编辑中心节点标题与备注", en: "Edit centre title and notes" },
  backUpLink: { zh: "← 返回上级", en: "← Back" },
  noChildren: { zh: "（无下级节点）", en: "(no child nodes)" },
  toggleCenterNotesAria: {
    zh: "展开/收起中心备注",
    en: "Expand / collapse centre notes",
  },
  addChildTitle: {
    zh: "双击添加子节点（标题 + 备注）",
    en: "Double-click to add a child (title + notes)",
  },
  addChildHint: { zh: "+ 双击添加", en: "+ double-click to add" },
  cellTitleWithChildren: {
    zh: "{slot} {title}（单击左下「下级 {sub}」进入下一级；单击空白处定位 MD；双击空白处编辑；拖动可调整同级顺序）",
    en: "{slot} {title} (click “{sub} children” to drill down; click blank area to locate in MD; double-click blank area to edit; drag to reorder)",
  },
  cellTitleLeaf: {
    zh: "{slot} {title}（双击标题进入以其为中心的九宫格；单击空白处定位 MD；双击空白处编辑；拖动可调整同级顺序）",
    en: "{slot} {title} (double-click the title to centre this node; click blank area to locate in MD; double-click blank area to edit; drag to reorder)",
  },
  childrenN: { zh: "下级 {n}", en: "{n} children" },
  enterNextLevel: { zh: "单击进入下一级九宫格", en: "Click to drill down" },
  enterAsCenterAria: {
    zh: "以该节点为中心进入下级",
    en: "Drill down with this node as centre",
  },
  toggleNotesAria: { zh: "展开/收起备注", en: "Expand / collapse notes" },
  toggleNotesTitle: {
    zh: "展开/收起本格备注（可覆盖全局设置）",
    en: "Expand / collapse notes for this cell (overrides the setting)",
  },
  locateAria: { zh: "在 Markdown 中打开并定位", en: "Open and locate in Markdown" },
  editNodeAria: { zh: "编辑节点标题与备注", en: "Edit node title and notes" },
  imageFallback: { zh: "图片", en: "Image" },
  imageAlt: { zh: "图片缩略图", en: "Image thumbnail" },
  imageZoomTitle: { zh: "点击放大查看图片", en: "Click to enlarge" },
  imageLightboxClose: { zh: "关闭图片预览", en: "Close image preview" },
  imageLightboxPrev: { zh: "上一张图片", en: "Previous image" },
  imageLightboxNext: { zh: "下一张图片", en: "Next image" },
  imageLightboxCounter: { zh: "第 {i} 张 / 共 {n} 张", en: "{i} of {n}" },
  imageLightboxHint: {
    zh: "点击空白处或按 Esc 关闭；左右方向键切换图片",
    en: "Click outside or press Esc to close; arrow keys switch images",
  },
  backLink: { zh: "← 返回", en: "← Back" },
  moreChildren: {
    zh: "更多子节点 ({from}–{to}) ›",
    en: "More children ({from}–{to}) ›",
  },

  // ---------------------------------------------------------------- modal
  modalTitle: { zh: "标题", en: "Title" },
  modalTitlePlaceholder: { zh: "输入标题…", en: "Enter a title…" },
  modalNotes: { zh: "备注", en: "Notes" },
  modalNotesPlaceholder: {
    zh: "输入备注内容，每行一条…（图片链接 / ![[附件]] 也可写在这里）",
    en: "One note per line… (image links / ![[attachments]] can be edited here too)",
  },
  editHintLabel: { zh: "编辑说明", en: "Edit help" },
  createHintLabel: { zh: "新建说明", en: "Create help" },
  cancel: { zh: "取消", en: "Cancel" },
  saveEdit: { zh: "保存修改", en: "Save changes" },
  addNode: { zh: "添加节点", en: "Add node" },
  noticeTitleRequired: { zh: "请填写节点标题", en: "Please enter a node title" },

  // ---------------------------------------------------------------- view / commands
  viewTitle: { zh: "九宫格 · {name}", en: "Mandala · {name}" },
  viewTitleEmpty: { zh: "九宫格 · Mandala", en: "Mandala · 9go" },
  noFileSpecified: {
    zh: "未指定笔记。请通过命令面板「以九宫格打开当前笔记」或在笔记 frontmatter 加 mandala: true。",
    en: "No note selected. Use the command “Open current note as Mandala” or add `mandala: true` to the note frontmatter.",
  },
  noMarkdownView: {
    zh: "未找到同一笔记的 Markdown 视图；可在设置里把「无分屏时」改为自动分屏或新标签。",
    en: "No Markdown view for the same note; set “When no split Markdown view” to auto-split or new tab in settings.",
  },
  createHint: {
    zh: "你双击了编号 {slot} 的空格。新节点按顺序追加为「{crumb}」的第 {index} 个子节点，编号 {number}；前面的格子未满 8 个时，会自动排在最后一个有内容的节点之后（不占用「更多子节点」格）。标题与备注会写回当前笔记。",
    en: "You double-clicked empty slot {slot}. The new node is appended as child {index} of “{crumb}”, numbered {number}. When the earlier cells are not full it is placed after the last filled node (never in the “More children” slot). Title and notes are written back to the note.",
  },
  noticeNotWritten: { zh: "未写入：节点标题为空。", en: "Not written: the node title is empty." },
  noticeAdded: { zh: "已添加子节点「{title}」", en: "Added child node “{title}”" },
  noticeWriteFailed: { zh: "写入节点失败：", en: "Failed to write node: " },
  noticeRootNoLine: {
    zh: "笔记标题（根中心）没有对应的 Markdown 行，请在 Markdown 中修改文件名或第一个标题。",
    en: "The note title (root centre) has no Markdown line; rename the file or edit the first heading in Markdown.",
  },
  noticeNodeNotFound: {
    zh: "未找到该节点对应的 Markdown 行，请刷新九宫格后重试。",
    en: "No Markdown line found for this node; refresh the grid and try again.",
  },
  styleCallout: { zh: "> 引用块", en: "> blockquote" },
  styleParagraph: { zh: "普通段落", en: "plain paragraph" },
  editHint: {
    zh: "正在编辑「{title}」。标题与备注会写回当前笔记；备注按当前设置以 {style} 重写（下级节点、兄弟节点、frontmatter 不受影响）。标题未改动时原行原样保留。备注框显示原始写法：图片链接、![[附件]]、[[笔记#^块ID]] 可直接改或删，未改动的行原样写回。",
    en: "Editing “{title}”. Title and notes are written back to the note; notes are rewritten as {style} (children, siblings and frontmatter are untouched). An unchanged title line is kept byte-for-byte. The notes box shows the raw syntax: image links, ![[attachments]] and [[note#^block-id]] can be edited or deleted; unchanged lines are written back as-is.",
  },
  noticeReadFailed: { zh: "读取笔记失败：", en: "Failed to read note: " },
  noticeNodeChanged: { zh: "节点已变化，未写入。", en: "The node changed; nothing was written." },
  noticeNoChange: { zh: "节点内容没有变化。", en: "No changes to this node." },
  noticeUpdated: { zh: "已更新节点「{title}」", en: "Updated node “{title}”" },
  noticeUpdateFailed: { zh: "更新节点失败：", en: "Failed to update node: " },
  noticeReordered: {
    zh: "已调整顺序：第 {from} 个 → 第 {to} 个",
    en: "Reordered: position {from} → {to}",
  },
  noticeReorderFailed: { zh: "调整顺序失败：", en: "Failed to reorder: " },
  noticeRootAlready: {
    zh: "中心已是根节点（笔记标题），子节点无法再上升一级。",
    en: "The centre is already the root (note title); children cannot be promoted further.",
  },
  noticeCannotPromote: {
    zh: "未写入：该节点无法上升一级（结构不允许）。",
    en: "Not written: this node cannot be promoted (structure does not allow it).",
  },
  noticePromoted: {
    zh: "已将「{title}」上升一级，与「{center}」同级",
    en: "Promoted “{title}” one level; now a sibling of “{center}”",
  },
  noticePromoteFailed: { zh: "上升节点失败：", en: "Failed to promote node: " },
  commandOpen: {
    zh: "以九宫格（Mandala）打开当前笔记",
    en: "Open current note as Mandala (3×3) view",
  },
  commandSwitch: {
    zh: "九宫格：把当前标签切换为 Mandala 视图",
    en: "Mandala: replace current tab with the 3×3 view",
  },
  commandMenu: { zh: "以九宫格（Mandala）打开", en: "Open as Mandala (3×3)" },
  embedTitle: { zh: "九宫格", en: "Mandala" },
  noticeOpenMdFirst: {
    zh: "请先打开一篇 Markdown 笔记",
    en: "Open a Markdown note first",
  },

  // ---------------------------------------------------------------- settings: language
  setLanguage: { zh: "界面语言", en: "Interface language" },
  setLanguageDesc: {
    zh: "中文 / English / 跟随 Obsidian 界面语言。切换后九宫格与设置面板立即刷新；命令面板里的名称需重启插件后更新。",
    en: "中文 / English / follow the Obsidian UI language. The grid and this settings tab refresh immediately; command-palette names update after reloading the plugin.",
  },
  optLangZh: { zh: "中文", en: "中文 (Chinese)" },
  optLangEn: { zh: "English", en: "English" },
  optLangAuto: { zh: "跟随 Obsidian", en: "Follow Obsidian" },

  // ---------------------------------------------------------------- settings
  settingsTitle: { zh: "9go · 九宫格（Mandala）", en: "9go · Mandala (3×3) view" },
  setKeywords: { zh: "触发关键词", en: "Trigger keywords" },
  setKeywordsDesc: {
    zh: "逗号分隔。frontmatter 键、frontmatter 值或 %%标记%% 命中即识别，默认 mandala。",
    en: "Comma separated. A frontmatter key, frontmatter value or %%marker%% match triggers the view; default is mandala.",
  },
  setAutoOpen: { zh: "自动打开标记笔记", en: "Auto-open tagged notes" },
  setAutoOpenDesc: {
    zh: "打开含关键词的 Markdown 笔记时，自动把该标签切换为九宫格视图（每个文件每次会话最多一次）。",
    en: "When opening a Markdown note with a matching keyword, switch its tab to the Mandala view (once per file per session).",
  },
  setShowNotes: { zh: "默认显示备注", en: "Show notes by default" },
  setShowNotesDesc: {
    zh: "每个格子在标题下显示部分备注内容；关闭时可用格子右下角 ⌄ 单独展开。",
    en: "Show a short note preview under each cell title; when off, use the ⌄ button in the cell corner to expand it.",
  },
  setNoteMaxChars: { zh: "备注最大字数", en: "Max note length" },
  setNoteMaxCharsDesc: {
    zh: "超出部分以 … 截断，避免格子溢出。",
    en: "Longer notes are truncated with … to keep cells from overflowing.",
  },
  setThumbnails: { zh: "九宫格显示图片缩略图", en: "Show image thumbnails" },
  setThumbnailsDesc: {
    zh: "格子标题或备注里的图片会缩略显示：支持外链 ![](https://…)、库内附件 ![[x.png]]，以及 [[笔记#^块ID]] 块引用（自动读取该块里的第一张图）。关闭后退化为原来的纯文本备注。",
    en: "Images in a cell title or note are shown as thumbnails: external ![](https://…), vault attachments ![[x.png]] and [[note#^block-id]] block references (first image in that block). Turn off to fall back to plain-text notes.",
  },
  setThumbMaxHeight: { zh: "缩略图最大高度", en: "Max thumbnail height" },
  setThumbMaxHeightDesc: {
    zh: "单位 px（32–320），每格最多显示 3 张；超出部分不渲染。默认 96。",
    en: "In px (32–320), at most 3 images per cell; extra images are not rendered. Default 96.",
  },
  setRootSource: { zh: "中心格标题来源", en: "Centre title source" },
  setRootSourceDesc: {
    zh: "默认显示笔记标题（文件名）；可改为显示第一个一级标题的文字。仅影响显示，不改变层级结构。",
    en: "Show the note title (filename) by default, or the first level-1 heading. Display only; the outline is unchanged.",
  },
  optFilename: { zh: "笔记标题（文件名）", en: "Note title (filename)" },
  optFirstH1: { zh: "第一个一级标题", en: "First level-1 heading" },
  setAutoCollapse: { zh: "自动折叠单根", en: "Auto-collapse single root" },
  setAutoCollapseDesc: {
    zh: "笔记只有一个一级标题时，自动以该标题为中心、显示其二级节点（仍可返回上级）。",
    en: "When a note has exactly one level-1 heading, centre on it and show its level-2 children (you can still go back).",
  },
  setEmbedHeight: { zh: "内嵌九宫格高度", en: "Embedded grid height" },
  setEmbedHeightDesc: {
    zh: "```mandala 代码块渲染高度（px）。",
    en: "Render height (px) of a ```mandala code block.",
  },
  secLayout: { zh: "排列 · 编号 · 拖动", en: "Layout · numbering · drag" },
  setFirstSlot: { zh: "第 1 个子节点的位置", en: "Position of the first child" },
  setFirstSlotDesc: {
    zh: "环绕 8 格中，第 1 个子节点落在哪个方位；其余按排序方向依次排布，格子左上角的层级编号随之同步调整。",
    en: "Which of the 8 surrounding cells holds the first child; the rest follow the chosen direction and the cell numbers move with them.",
  },
  setSortDirection: { zh: "子节点排序方向", en: "Child ordering direction" },
  setSortDirectionDesc: {
    zh: "从第 1 个节点开始，顺时针或逆时针填满其余格位。",
    en: "Fill the remaining cells clockwise or counter-clockwise from the first node.",
  },
  optCw: { zh: "顺时针", en: "Clockwise" },
  optCcw: { zh: "逆时针", en: "Counter-clockwise" },
  setSlotCoords: { zh: "显示格位坐标标签", en: "Show slot coordinate labels" },
  setSlotCoordsDesc: {
    zh: "格子右上角额外显示固定坐标 1.1–1.8（与左上角层级编号不同）。默认关闭，避免两套编号混淆。",
    en: "Show fixed coordinates 1.1–1.8 in the top-right corner (distinct from the outline numbers). Off by default to avoid confusion.",
  },
  setDragReorder: { zh: "拖动调整同级顺序", en: "Drag to reorder siblings" },
  setDragReorderDesc: {
    zh: "拖动子节点到同级两格之间（靠左/上半区=插到它前面，靠右/下半区=插到它后面），同步重排 Markdown 原文中的整段标题与子树。",
    en: "Drop a child between two siblings (left/top half = before it, right/bottom half = after it); the whole heading block and subtree are rewritten in Markdown.",
  },
  numberingNote: {
    zh: "编号规则：一级 1 / 2 / 3…，二级 1.1 / 1.2…，三级 1.1.1…；超过 3 层压缩为「首段...末两段」，例如第 4 级 1.1.1.1 显示为 1...1.1。",
    en: "Numbering: level 1 → 1 / 2 / 3…, level 2 → 1.1 / 1.2…, level 3 → 1.1.1…; beyond 3 levels it is compacted as “first...last-two”, e.g. level 4 1.1.1.1 shows as 1...1.1.",
  },
  secInteraction: {
    zh: "交互 · 光标跟随、编辑与定位",
    en: "Interaction · cursor follow, edit & locate",
  },
  setFollowCursor: {
    zh: "光标跟随 · 分屏 MD 编辑时自动切换中心",
    en: "Follow cursor · switch centre while editing MD",
  },
  setFollowCursorDesc: {
    zh: "开启后每 250ms 读取活动 Markdown 视图的光标行，把同一笔记的九宫格中心切到光标所在标题/列表节点并高亮对应格；不抢焦点、不写文件。需同时打开 MD 与九宫格两个视图。",
    en: "Every 250 ms, read the caret line of the active Markdown view and centre the grid on that heading/list node, highlighting its cell. Never steals focus or writes files. Requires both the MD view and the grid to be open.",
  },
  setFollowLeaf: { zh: "光标所在节点没有下级时", en: "When the caret node has no children" },
  setFollowLeafDesc: {
    zh: "回退到父级：以父节点为中心、翻到该节点所在页并高亮该格（推荐，叶子节点也能看到同级）；仍以它为中心：严格按光标节点作中心，环绕 8 格为空。",
    en: "Fall back to the parent: centre on the parent, jump to that page and highlight the cell (recommended — leaf nodes still show their siblings). Keep it centred: strictly use the caret node, with 8 empty cells.",
  },
  optParent: {
    zh: "回退到父级并高亮该格（推荐）",
    en: "Fall back to parent and highlight (recommended)",
  },
  optSelf: { zh: "仍以光标节点为中心", en: "Keep the caret node as centre" },
  interactionNote: {
    zh: "交互分工（固定，不再提供开关）：有下级的节点 → 点左下「下级 N」进入下一级（双击标题不响应）；无下级的节点 → 双击标题进入以其为中心的九宫格；单击节点空白处 → 在分屏 Markdown 中定位；双击节点空白处（或点右下 ✎）→ 编辑标题与备注；空白格双击 → 新建子节点。",
    en: "Interaction map (fixed, no toggles): a node with children → click “N children” to drill down (double-clicking its title does nothing); a leaf → double-click its title to centre on it; single-click a blank area → locate in the split Markdown view; double-click a blank area (or the ✎ button) → edit title and notes; double-click an empty cell → create a child node.",
  },
  setNoteStyle: { zh: "新建节点 · 备注写法", en: "New node · note syntax" },
  setNoteStyleDesc: {
    zh: "双击空白格输入标题与备注，按当前层级写回笔记（九宫格视图中始终可用，内嵌 ```mandala 代码块除外）。列表节点的备注自动缩进一层，避免顶格 > 引用块打断列表，使下级节点在阅读模式里退化成「- 」纯文本。",
    en: "Double-click an empty cell to enter a title and notes, written back at the current level (always available in the grid view, but not inside ```mandala blocks). Notes of list nodes are indented one extra level: a flush-left > blockquote would terminate the list and turn following Tab-indented children into literal “- ” text in Reading view.",
  },
  optCallout: {
    zh: "备注写成 > 引用块（推荐，最安全）",
    en: "Notes as > blockquotes (recommended, safest)",
  },
  optParagraph: { zh: "备注写成普通段落", en: "Notes as plain paragraphs" },
  setSingleClick: { zh: "单击节点联动 Markdown 分屏", en: "Single-click locates in Markdown" },
  setSingleClickDesc: {
    zh: "单击中心格或子格时，跳到同一笔记的 Markdown 视图对应行，并像搜索结果一样高亮一下再淡化。",
    en: "Clicking the centre or a child cell jumps to the matching line in the split Markdown view and flashes a highlight that fades out.",
  },
  setHighlight: { zh: "高亮持续时间", en: "Highlight duration" },
  setHighlightDesc: {
    zh: "定位后高亮保持的时长（毫秒，300–10000），到时再淡出约 220ms；输入后按回车或点到别处生效。",
    en: "How long the highlight stays after locating (ms, 300–10000), then fades for ~220 ms. Press Enter or click away to apply.",
  },
  setFallback: { zh: "无分屏 Markdown 时", en: "When no split Markdown view" },
  setFallbackDesc: {
    zh: "找不到同一笔记的 Markdown 视图时：自动分屏 / 新标签打开 / 不处理。",
    en: "If no Markdown view for the same note exists: auto-split / open in a new tab / do nothing.",
  },
  optSplit: { zh: "自动分屏打开", en: "Auto-split" },
  optTab: { zh: "新标签打开", en: "Open in new tab" },
  optNone: { zh: "不处理", en: "Do nothing" },
  secUsage: { zh: "用法", en: "Usage" },
  usage1: {
    zh: "frontmatter：mandala: true 或 mindmap-structure: mandala",
    en: "frontmatter: `mandala: true` or `mindmap-structure: mandala`",
  },
  usage2: { zh: "行内标记：%%mandala%%", en: "Inline marker: `%%mandala%%`" },
  usage3: {
    zh: "内嵌：```mandala 代码块，块内用同样的 Markdown 大纲",
    en: "Embedded: a ```mandala code block with the same Markdown outline",
  },
  usage4: {
    zh: "双击空白格 → 输入标题 + 备注，按当前层级写回笔记（追加为最后一个子节点）",
    en: "Double-click an empty cell → enter title + notes, written back at the current level (appended as the last child)",
  },
  usage5: {
    zh: "双击已填充格 → 编辑该节点标题 + 备注（可在设置里改回下钻）；✎ / ⤵ 按钮触发另一种操作",
    en: "Double-click a filled cell → edit that node's title + notes; the ✎ / ⤵ buttons trigger the other action",
  },
  usage6: {
    zh: "单击中心格 / 子格 → 在分屏 MD 中定位并高亮对应节点行；高亮按「高亮持续时间」设置保持（默认 1400ms）后淡出",
    en: "Single-click the centre or a child → locate and highlight the matching line in the split MD view; the highlight lasts per “Highlight duration” (default 1400 ms) then fades",
  },
  usage7: {
    zh: "开启「光标跟随」后，MD 光标移动 → 九宫格中心自动切到该节点并高亮对应格（工具栏 ⌖ 标记）",
    en: "With “Follow cursor” on, moving the MD caret re-centres the grid on that node and highlights its cell (⌖ badge in the toolbar)",
  },
  usage8: {
    zh: "格子右下角 ↗ → 强制在 Markdown 中打开并定位；中心格「返回上级」回退",
    en: "↗ in the cell corner → force open and locate in Markdown; “Back” in the centre cell goes up a level",
  },
  usage9: {
    zh: "拖动子节点到同级两格之间 → 调整同级顺序并写回 Markdown",
    en: "Drag a child between two siblings → reorder and write back to Markdown",
  },
  usage10: {
    zh: "拖动子节点到中心格 → 该节点上升一级，成为与中心同级的下一个兄弟",
    en: "Drag a child onto the centre cell → promote it one level, becoming the centre's next sibling",
  },
  usage11: {
    zh: "序列末格（第 8 格）无论有无内容都常驻「更多子节点 (9–16) ›」，点击进入下一批节点的编辑页；新建节点始终按顺序排在最后一个有内容节点之后",
    en: "The 8th cell always shows “More children (9–16) ›” even when empty; click it to edit the next batch. New nodes are always appended after the last filled node",
  },
  secReference: { zh: "参考与致谢", en: "Reference & credits" },
  setReference: {
    zh: "语法与交互参考：gogoga-mindmap",
    en: "Syntax & interaction reference: gogoga-mindmap",
  },
  setReferenceDesc: {
    zh: "本插件的九宫格写法（标题 / 列表 / Tab 备注 / %%标记%%）参考自 JackWeiGogoga 的 gogoga-mindmap，按同一套数据模型独立实现，两个插件可同时启用、互不干扰。源码与文档见其仓库。",
    en: "The outline syntax (headings / lists / Tab-indented notes / %%markers%%) follows JackWeiGogoga's gogoga-mindmap. This is an independent implementation of the same data model, so both plugins can be enabled at once without conflicts. See their repository for sources and docs.",
  },
  openGitHub: { zh: "打开 GitHub", en: "Open on GitHub" },
} as const;

export type StringKey = keyof typeof STRINGS;

/** Labels for the 8 ring positions (must match layout.ts FIRST_SLOT_LABEL). */
const SLOT_LABELS: Record<string, { zh: string; en: string }> = {
  top: { zh: "上（正上方）", en: "Top" },
  "top-right": { zh: "右上", en: "Top-right" },
  right: { zh: "右（正右方）", en: "Right" },
  "bottom-right": { zh: "右下", en: "Bottom-right" },
  bottom: { zh: "下（正下方）", en: "Bottom" },
  "bottom-left": { zh: "左下", en: "Bottom-left" },
  left: { zh: "左（正左方）", en: "Left" },
  "top-left": { zh: "左上", en: "Top-left" },
};

export function slotLabel(key: string): string {
  const e = SLOT_LABELS[key];
  if (!e) return key;
  return CURRENT === "en" ? e.en : e.zh;
}

let CURRENT: ResolvedLang = "zh";

/** Best-effort read of Obsidian's UI language; unknown locales fall back to zh. */
function obsidianLang(): ResolvedLang {
  try {
    const w = typeof window !== "undefined"
      ? (window as unknown as {
        moment?: { locale?: () => string };
        i18next?: { language?: string };
      })
      : null;
    const loc = String(w?.moment?.locale?.() || w?.i18next?.language || "").toLowerCase();
    if (loc.indexOf("zh") === 0) return "zh";
    if (loc) return "en";
    if (typeof document !== "undefined") {
      const html = String(document.documentElement.getAttribute("lang") || "").toLowerCase();
      if (html.indexOf("zh") === 0) return "zh";
      if (html) return "en";
    }
  } catch (_e) {
    /* ignore: an unknown host must never break the plugin */
  }
  return "zh";
}

export function setLanguage(value: Lang): void {
  CURRENT = value === "auto" ? obsidianLang() : value === "en" ? "en" : "zh";
}

export function currentLanguage(): ResolvedLang {
  return CURRENT;
}

/** Translate a key; `{name}` placeholders are filled from `vars`. */
export function t(key: StringKey, vars?: Vars): string {
  const entry = STRINGS[key];
  const raw: string = entry
    ? (CURRENT === "en" ? entry.en : entry.zh)
    : String(key);
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
  );
}

/**
 * main.ts uses `tr` because many Obsidian `addText((t) => ...)` callbacks
 * name their component `t` and would shadow the translator.
 */
export const tr = t;
