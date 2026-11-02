# T3 Code Diff panel: UI and interaction design

Source: `/tmp/t3src/t3code` at c8a601c0, web app `apps/web/src`. All paths below are relative to `apps/web/src` unless they start with `packages/`, `apps/server/` or `patches/`. Line numbers are `file:line`. Everything here was read from source; T3 was not run.

---

## 0. Summary

- The renderer is **`@pierre/diffs` 1.6.1** (pnpm catalog `pnpm-workspace.yaml:59`), **patched** (`patches/@pierre%2Fdiffs@1.6.1.patch`, 1096 lines). The patch adds find-in-diff, `onRevealSearchMatch`, `openSearch()/closeSearch()`, `+1,234`-style counts and some resize fixes. The file tree is **`@pierre/trees` 1.0.0-beta.6** (`apps/web/package.json:33`).
- They use Pierre's virtualized **`CodeView`** (`@pierre/diffs/react`), with one item per file, through one adapter, `components/diffs/StyledDiffCodeView.tsx`. Syntax highlighting runs in a **worker pool** (`components/DiffWorkerPoolProvider.tsx`) with the **"highlights" WASM highlighter** rather than Shiki (`lib/syntaxHighlighting.ts:22`). Themes are `pierre-dark` and a custom readable light theme (`lib/diffRendering.ts:7-10`).
- Options they set (`components/DiffPanel.tsx:1441-1452`): `diffStyle: "split" | "unified"`, **`lineDiffType: "none"` (word-level diff is OFF)**, `overflow: "wrap" | "scroll"`, `stickyHeaders: true`, `themeType`, `preferredHighlighter`, plus `loadDiffFiles` for git scopes, so "expand context" can pull full file contents.
- One panel with a scope dropdown: **Changes** (branch vs base), **Uncommitted**, **Latest turn**, **Turn ▸ N**, **Commits ▸ …**, plus a hidden **Tool call** scope. The selection is stored **per thread** in localStorage. File folds are kept **per thread + scope** for the session only. The toggles are global settings or local state.
- Comments: select lines, click the gutter "+", and an inline textarea opens ("Add a comment…", ⌘/Ctrl Enter). Submitting adds a **ReviewCommentContext** to the thread's composer draft and puts an inline **chip** `file.ts L12 to L18` in the prompt. At send time the chip becomes `[Review comment: …; ref=…]`, and a `<t3_context>` envelope with file, range, section, comment and a fenced diff hunk is appended.
- There is **no** j/k/n/p navigation, **no** "Viewed" checkbox and **no** per-file "binary" UI in T3's code. Binary or unparsable patches fall back to Pierre's own rendering or a raw `<pre>`.

---

## 1. Components and files

| File | Role |
|---|---|
| `components/DiffPanel.tsx` (1495 lines) | The whole panel: data selection, header toolbar, empty/loading/error states, wiring to the code view and file tree |
| `components/DiffPanelShell.tsx` | Outer frame plus skeletons (`DiffPanelLoadingState`, `DiffFileHeaderSkeleton`) |
| `components/diffs/StyledDiffCodeView.tsx` | The single styled wrapper around Pierre `CodeView`: injected CSS, item metrics, worker pool |
| `components/diffs/AnnotatableCodeView.tsx` | Adds line selection, the gutter "+" and inline comment annotations; writes to the composer draft store |
| `components/diffs/DiffCommentAnnotation.tsx` | Inline comment draft editor and the posted-comment row |
| `components/diffs/commentSubmitShortcut.ts` | ⌘/Ctrl+Enter rule |
| `components/diffs/DiffFileTree.tsx` + `diffFileTree.logic.ts` | Side file tree (Pierre trees) with git status and reveal/sync |
| `components/diffs/DiffFileStatus.tsx` | Per-file header icon: retry (error) or info (truncated) |
| `components/diffs/DiffFileLoadingBoundary.tsx` | Infinite-scroll sentinel that loads the next files of a huge diff |
| `components/diffs/useReviewFilePatches.ts` | Per-file lazy patch loading (batches of 4) for diffs that were truncated |
| `components/diffs/useHideTestFiles.ts` | localStorage boolean `t3code.diffHideTestFiles` |
| `components/diffs/useCodeViewFileReveal.ts` | "Scroll to file once the viewer holds it" helper |
| `components/diffs/codeViewSearch.test.ts` | Tests `collectMatches` from the **patched-in** `CodeViewSearch.js` (find lives in the patch, not in app code) |
| `diffPanelStore.ts` | Zustand: persisted per-thread selection and remembered base ref; session-only fold state |
| `reviewCommentContext.ts` | Builds a comment's range label, diff excerpt and selection |
| `lib/composerContextRecords.ts`, `packages/shared/src/composerContextReferences.ts` | Chip label, the record sent with the message, and the provider text |
| `lib/diffRendering.ts` | Patch parsing (`parsePatchFiles`), whitespace hiding, theme names, **colour CSS** |
| `lib/diffCollapse.ts` | All-collapsed check and toggle all |
| `components/chat/DiffStatLabel.tsx` | `+N -M` label with compact `1.2k` formatting |
| `components/DiffFilePathCopyButton.tsx` | "Copy path" button in each file header |
| `diffFileActions.ts` | Clicking a file title opens the file in the right panel (or in the editor) |

---

## 2. Rendering library: @pierre/diffs 1.6.1 (patched)

### 2.1 How it is mounted
`StyledDiffCodeView` (`components/diffs/StyledDiffCodeView.tsx:220-258`):
- Wraps `<CodeView>` in `<DiffWorkerPoolProvider>` (a shared pool of `max(2, min(6, cores/2))` workers with a 30 s idle TTL; the pool follows the light/dark theme, `DiffWorkerPoolProvider.tsx:20-24`).
- Class `diff-render-surface [--code-background:var(--background)] outline-none` (the diff sits on the app background, not the card).
- `itemMetrics: { diffHeaderHeight: 32, hunkSeparatorHeight: 24, spacing: 0, paddingTop: 0, paddingBottom: 8 }` and `layout: { paddingTop: 0, paddingBottom: 0, gap: 0 }` (`:242-253`). These must match the CSS exactly, because the virtualizer positions rows from them (32 px headers, 24 px separators).
- `unsafeCSS` = `DIFF_SURFACE_THEME_UNSAFE_CSS` (colours, `lib/diffRendering.ts:267-340`) + `DIFF_VIEW_UNSAFE_CSS` (layout, `StyledDiffCodeView.tsx:15-204`) + optional extra.

### 2.2 Options passed (`components/DiffPanel.tsx:1441-1452`)
```ts
options={{
  diffStyle: diffLayout === "split" ? "split" : "unified",
  lineDiffType: "none",            // no word/char-level intra-line highlighting
  overflow: wordWrap ? "wrap" : "scroll",
  theme: resolveDiffThemeName(resolvedTheme),   // "pierre-dark" | readable light
  preferredHighlighter: PREFERRED_HIGHLIGHTER, // "highlights" (WASM lexers, 10-40x faster than Shiki)
  themeType: resolvedTheme,
  stickyHeaders: true,
  onPostRender: codeViewReveal.flush,
  ...(currentLoadDiffFiles ? { loadDiffFiles } : {}),  // full file contents, for expanding context
}}
```
AnnotatableCodeView adds `enableGutterUtility: draft === null`, `enableLineSelection: draft === null` and `onGutterUtilityClick: beginComment` (`AnnotatableCodeView.tsx:530-535`).

- **Word-level diff**: deliberately off (`lineDiffType: "none"`). Rows are tinted, but changed words are not emphasised. (The CSS still defines `--diffs-bg-*-emphasis-override`, which would apply if you turned it on.)
- **Line numbers**: Pierre default (shown). The indicator style is Pierre's default `bars`. T3's CSS targets `[data-indicators="bars"]`, which draws a 4 px accent bar on selected line numbers (`StyledDiffCodeView.tsx:59-78`).
- **Split vs stacked**: user setting `diffLayout`, `"stacked"` by default (`packages/contracts/src/settings.ts:58-60,423`). In split + wrap mode, both code columns are forced to equal width with `--diffs-code-grid: var(--diffs-grid-number-column-width) minmax(0,1fr)` to stop rewrap jitter (`StyledDiffCodeView.tsx:16-21`).
- **Hunk expansion ("expand context")**: Pierre's hunk separators (`[data-separator="line-info"]`), each with an `[data-expand-button]`. They are styled as quiet 24 px rows: 11 px sans text at 50% foreground, brighter on hover (`StyledDiffCodeView.tsx:111-140`). For git scopes, `loadDiffFiles` (`lib/diffFileContents.ts`, server RPC `reviewEnvironment.diffFileContents`) fetches the old and new file contents, so expanding can reveal any unchanged lines. Turn and tool-call scopes pass no loader, so expansion is limited to what the patch holds. (The separator label text comes from Pierre and could not be checked here, since `node_modules` is absent.)
- **Virtualization**: Pierre `CodeView` virtualizes both the file list and the lines inside each file. Collapsed items are never remeasured, which is why the header height is fixed at 32 px (`StyledDiffCodeView.tsx:96-101`).
- **Expand animation**: a newly mounted `[data-diff],[data-file]` fades its opacity in over 200 ms with `@starting-style`. Height is not animated, because the viewer owns geometry. `prefers-reduced-motion` turns it off (`:183-203`).

### 2.3 What the patch adds (`patches/@pierre%2Fdiffs@1.6.1.patch`)
- **Find in diff** (`CodeViewSearch.js`, new): Pierre's editor `SearchPanelWidget` in **find-only** mode (`allowReplace: false`). It opens a sticky panel at the top of the viewer, under the sticky header offset, 8 px down. It searches the **diff data**, not the DOM, so it finds matches in virtualized rows, unexpanded context (`expandedHunks: true`) and **folded files**. Navigating to a match in a collapsed file calls `onRevealSearchMatch(item)`; T3 then unfolds it (`DiffPanel.tsx:737-744,1428`). Supports case-sensitive, whole-word and regex modes, at most 100 000 matches, single-line queries only. If text is selected (one line), it seeds the query. Highlighting uses the CSS Custom Highlight API (`::highlight(diffs-search-match)` and `diffs-search-focus`). T3 themes the panel through `--diffs-search-panel-bg: var(--popover)`, `-fg: var(--popover-foreground)`, `-accent: var(--primary)` and `-font: var(--font-sans)` (`index.css`, `.diff-render-surface`).
- Header counts are formatted with `toLocaleString()` (`-1,234`, `+5,678`).
- Re-exports `@pierre/diffs/types`, `/utils/parsePatchFiles` and `/utils/getFiletypeFromFileName`.

---

## 3. Layout

### 3.1 Frame (`components/DiffPanelShell.tsx`)
- Modes: `"inline" | "sheet" | "sidebar" | "embedded"`. Inline: `w-[42vw] min-w-[360px] max-w-[560px] border-l` (`:32-34`).
- Header row: `flex h-10 border-b border-border/60 px-4` (or `px-2` when embedded). In Electron it doubles as the window drag region at `--workspace-topbar-height` (`:10-19`).
- Body: the code view (`flex-1`) with an optional **file tree on the right** (`FileExplorerPane resizable`, `border-l`, 40% default width, 160 to 560 px, keeps at least 256 px for the code, width saved under `t3code:diff-file-tree-width`, resize label "Resize Changes files"; `DiffPanel.tsx:1454-1470`, `files/FileExplorerPane.tsx:8-10`).

### 3.2 Header toolbar, left group (`DiffPanel.tsx:789-1086`)
A container-query wrapper `@container/diff-refs`.

1. **Scope menu** (`DropdownMenu`, trigger `Button size="xs" variant="secondary"`, label plus `ChevronDown`). `aria-label="Diff scope: {label}"`. Trigger label (`:419-427`):
   - `Tool call` (only reachable from chat, not listed in the menu)
   - `Changes` (default; branch against base)
   - `Uncommitted`
   - `Latest turn` (when the selected turn is the newest)
   - `Turn {n}`
   - a commit's subject, or `Commit abc1234`

   Menu contents (`:826-955`):
   - radio items **Changes**, **Uncommitted**, **Latest turn**
   - submenu **Turn**: `Turn {n}` with a right-aligned short timestamp (`text-xs tabular-nums text-muted-foreground`), newest first
   - submenu **Commits** (`max-h-80 max-w-96`): each row shows the subject (truncated, full subject in a right tooltip), a relative time, and the 7-char SHA as an underlined mono link to the code host (`aria-label="Open commit abc1234"`). The selected row gets `bg-foreground/[0.08]`. The list is **frozen while open** and refreshed for next time (`:231-232,862-868`). Footer states: error text / `Checking file access...` / `This connection cannot read local diffs.` / `Loading commits...` / `No commits on this branch.` / `Showing latest {n} commits` (server limit 100 commits, `apps/server/src/vcs/GitVcsDriverCore.ts:79`).
   - When a commit is selected, its short SHA is shown next to the trigger as an underlined mono link with the URL as its tooltip (`:802-825`).
2. **Base-ref compare** (only for the `Changes` scope with file access, `:957-1085`): `head-branch → [base ▾]`. The `head →` part hides below 20 rem container width, and a plain `vs` shows instead. Tooltip `"{head} → {base}"`. `aria-label="Comparing {head} against {base}"`.
   - **Combobox** trigger `Button variant="ghost-muted" size="xs"`, `aria-label="Change comparison target. Currently {base}"`, label `Automatic` when unset.
   - Popup `w-72`: search input placeholder **`Search refs...`**; column header row (uppercase `text-3xs`) **`Branch`** | **`Remote`**; empty state **`No matching refs.`**; first item **`Automatic`**. Each branch row shows its label, and when both local and remote exist, a small **Switch** "Use remote version of {branch}". A remote-only ref shows a check icon with tooltip **`Remote only`**. Refs come from local and remote lists (100 each, filtered by the query on the server; the current head is excluded).
   - Choosing a ref selects the `branch` scope with that `baseRef`. "Automatic" means `null` (the server resolves the merge base: a configured `branch.X.t3-merge-base-ref`, otherwise the default branch).

### 3.3 Header toolbar, right group (`DiffPanel.tsx:1087-1247`), in order
| Control | Shown when | Icon | Label / tooltip |
|---|---|---|---|
| `DiffStatLabel` `+A -D` (`text-2xs`, inline) | there are files | — | aria `"{a} additions, {d} deletions"` |
| Refresh | git scope | `RefreshIcon` (spins while refreshing) | `Refresh diff` / `Refreshing diff…` |
| Collapse/expand all | there are files | `ChevronsDownUp` / `ChevronsUpDown` (morphing) | `Collapse all files` / `Expand all files` |
| Layout segmented toggle | always | `Rows3` (stacked) / `Columns2` (split) | aria `Diff layout`, `Stacked diff view`, `Split diff view` |
| Wrap toggle | always | `TextWrap` | `Enable line wrapping` / `Disable line wrapping` |
| Whitespace toggle | always | `Pilcrow` | `Hide whitespace changes` / `Show whitespace changes` (pressed = hiding) |
| Hide tests toggle | `testFileCount > 0` | `FlaskConicalOff` | `Hide test files` / `Show {n} hidden test file(s)` |
| File tree toggle | there are files | `FolderTree` | `Show file tree` / `Hide file tree` |

Icon buttons are `size="icon-sm" variant="ghost"`, and toggles are `variant="ghost" size="sm"`. Every one has a tooltip on top.

### 3.4 File headers (Pierre header plus T3 slots)
- Pierre renders: change icon, path (`[data-title]`), for renames the previous name (`[data-prev-name]`) and a rename icon, and metadata `-D +A` (`[data-deletions-count]`, `[data-additions-count]`). The path is truncated from the start with an ellipsis.
- T3 slots (`DiffPanel.tsx:1400-1440`):
  - `renderHeaderPrefix`: a collapse chevron (`ChevronDown`/`ChevronRight`, `size-4 text-muted-foreground/80`), `Button size="icon-micro" variant="ghost"`, aria `Expand {path}` / `Collapse {path}`, tooltip `Expand diff` / `Collapse diff`. It is disabled while the file is a lazy placeholder (`:134-173`).
  - `renderHeaderFilenameSuffix`: **Copy path** button (Copy morphs to Check, tooltip `Copy path` / `Copied`, anchored toast; `DiffFilePathCopyButton.tsx`), then `DiffFileStatus` (lazy diffs only): `RotateCw` "Retry loading diff" on error, or `Info` "Partial diff preview" with tooltip **"This file is too large to show in full. Counts include all changes."** (`DiffFileStatus.tsx`).
  - `renderHeaderMetadata` (lazy diffs only): replaces Pierre's counts with the server numstat `DiffStatLabel`, hiding Pierre's counts through `unsafeCSSExtra` (`DiffPanel.tsx:1414-1427`), so totals are correct even before the patch loads.
- Header CSS (`StyledDiffCodeView.tsx:86-181`): **sticky** `top:0; z-index:4`, bg `--code-background`, **exactly 32 px** tall, `padding-inline: 8px 12px`, `font-family: var(--font-sans)`, **12 px**, line-height 1. Counts use mono at 11 px with tabular numbers. Hover adds an inset 3 px left edge `color-mix(foreground 24%)` instead of a full background band. The title has `cursor:pointer` and on hover turns to `color-mix(foreground 84%, primary)`.
- Change icon colours (`lib/diffRendering.ts:323-339`): new uses `--diff-added-icon` (else the addition foreground); deleted uses the deletion foreground; change/rename uses `--diff-modified-icon`, a muted blue (`color-mix(info-foreground 50%, muted-foreground)`, `index.css:1283`), "so the common case stays quiet".
- **Header click behaviour** (`DiffPanel.tsx:1340-1368`): a click on the **title** opens the file (right-panel file viewer for the thread, otherwise the editor; `diffFileActions.ts`). A click **elsewhere on the header** toggles that file's fold. Clicks on buttons and links inside are left alone. Right-click on the title opens the file context menu.
- **"Viewed" checkbox: not present.**

### 3.5 File tree (`components/diffs/DiffFileTree.tsx`)
- Subheader `h-10 border-b border-border/60 px-2 text-xs`: **`Files`** (`font-medium text-foreground`), then the **count** (`ml-auto tabular-nums`), then (if there are folders) an expand/collapse-all-folders button (`Collapse all folders` / `Expand all folders`).
- Pierre `useFileTree({ density: "compact", flattenEmptyDirectories: true, initialExpansion: "open", search: false, icons: T3_PIERRE_ICONS, sort })` (`:83-93`). Folders are collapsible, start **open**, and single-child chains are flattened (`a/b/c/`).
- **Order** matches the code view: the tree keeps diff-list positions (`diffFileTreePositions`, `compareDiffFileTreeEntries`). The diff list is sorted by path with `Intl.Collator(numeric, sensitivity base)` (`useReviewFilePatches.ts:15-18,212,220`).
- **Status**: `model.setGitStatus([{path, status}])` with `added | deleted | renamed | modified`, mapped from Pierre `type` `new | deleted | rename-* | change` (`diffFileTree.logic.ts:17-29`). Pierre trees decides how status is drawn; T3 only themes the colours: `--trees-git-added/deleted/untracked-color-override` and `--trees-status-*-override`, set for the blue-orange scheme (`index.css`). (Whether Pierre trees draws letters or only colours could not be checked without `node_modules`.)
- A file path that is also a directory path gets an invisible `​` suffix in the model (`diffFileTreeModel`).
- Theme: transparent bg, selected `currentColor 12%`, hover `7%`, border `14%`, sans 0.75 rem, rounded rows `--radius-md` (`pierre-tree-theme.ts`).
- **Click a file** to `onSelectFile(path)`, which runs `revealDiffFile`: it unfolds the file, requests its lazy patch if it is not loaded, and scrolls the code view to the item with `align: "start"` (`DiffPanel.tsx:666-682`, `useCodeViewFileReveal.ts`). Clicking the already selected row reveals it again (`DiffFileTree.tsx:223-244`).
- An **external reveal** (the chat "Open diff" for a turn sets `filePath` and `revealRequestId++`) expands the file's ancestors, selects it, scrolls the tree to it (`nearest`) and scrolls the diff to it. It retries as the diff loads, until the file is there (`DiffPanel.tsx:684-698`, `DiffFileTree.tsx:150-181`).
- Tree visibility is **global** localStorage `t3code.diffFileTreeOpen`, off by default (`DiffPanel.tsx:114,224-228`).

### 3.6 Empty, loading and error states (exact strings)
Full-panel (`text-xs text-muted-foreground/70`, centred) (`DiffPanel.tsx:1253-1272`):
- `Select a thread to inspect turn diffs.`
- `Turn diffs are unavailable because this project is not a git repository.`
- `No completed turns yet.`
- `Checking file access...` (skeleton) / `This connection cannot read local diffs.`

Inside the body (`:1276-1335`):
- Banner (`border-b bg-muted/40 px-3 py-1.5 text-2xs`): `This preview exceeds the size limit. Changes shown are incomplete.` plus ` Totals include all changes.` when numstat exists.
- Banner: `This tool call changed {n} files. The recorded patch omits {m} of them.`
- Error line `text-2xs text-error/80`: the error message.
- Tool call without a patch: `The provider recorded file content without a diff.`, then a label and a `<pre>` per file (`Empty content.` if empty).
- Loading skeleton (`DiffPanelLoadingState`: header skeleton, separator, three code-line pills, two more headers) with an aria label of `Loading tool call diff...` / `Loading checkpoint diff...` / `Loading uncommitted changes...` / `Loading commit...` / `Loading changes...`.
- No patch: `No net changes in this selection.` (patch is empty) or `No patch available for this selection.`
- Unparsable patch: raw `<pre>` (`max-h-[72vh] rounded-md border p-3 font-mono text-2xs`) with the reason `Unsupported diff format. Showing raw patch.` / `Failed to parse patch. Showing raw patch.` (`lib/diffRendering.ts:175-185`).
- Lazy loading footer: `role="status" aria-label="Loading diff…"` with up to 4 header skeletons (`DiffFileLoadingBoundary.tsx`).

### 3.7 How a big diff stays fast
1. **Server caps** (`apps/server/src/vcs/GitVcsDriverCore.ts:74-81`): whole review patch **120 000 bytes**; one file's patch **1 MiB**; numstat metadata 16 MiB; untracked files 5 000; commits 100. Git runs `diff --find-renames --no-color --no-ext-diff --no-textconv --minimal [--ignore-all-space]` with forced `a/` `b/` prefixes (`:84-91,3420-3432`). Numstat always covers all files, so totals stay correct.
2. **Lazy per-file mode**: if the whole patch is truncated **and** numstat files exist (`lazySource`, `DiffPanel.tsx:476-479`), the panel builds placeholder items for every file from numstat (`isPartial`, `cacheKey …:pending`, shown collapsed with a disabled chevron). It fetches real per-file patches through `reviewEnvironment.diffFilePatch`, **first 4 files, then 4 more** each time the `DiffFileLoadingBoundary` sentinel comes within **600 px** of the viewport (`useReviewFilePatches.ts:164,227-237`, `DiffFileLoadingBoundary.tsx:13-24`). Revealing a file beyond the loaded range requests just that file. Failed files show the retry icon.
3. **Virtualization** in Pierre `CodeView`, fixed item metrics, worker-pool highlighting, and the WASM highlighter.
4. **Stable identity**: per-file `fileKey` (`prev\0path\0type`) and a content hash `fileVersion` (`lib/diffRendering.ts:199-265`), so only changed files repaint. The parsed patch is cached by FNV hash.
5. **Refresh policy**: no polling (`intervalMs: null`). It revalidates on **show** (the panel stays mounted while hidden), at most once per `LIVE_REFRESH_MIN_INTERVAL_MS`, and refetches on every workspace mutation id (`DiffPanel.tsx:369-381,592-609`).

---

## 4. Interactions

### 4.1 Keyboard
- **Mod+D**: toggle the diff panel (`packages/shared/src/keybindings.ts:166`, `when: "!terminalFocus"`).
- **Mod+F** while focus is in the viewer: open or refocus find (patch, `CodeViewSearch.handleKeyDown`). Find-again (`resolveFindAgainShortcut`, Pierre editor's next/previous shortcut) moves between matches. **Esc** closes find (focus returns to the viewer). Enter/Shift+Enter in the input go through the Pierre search widget.
- Comment editor: **Esc** cancels; **⌘/Ctrl+Enter** submits when the text is not blank (`DiffCommentAnnotation.tsx:112-121`, `commentSubmitShortcut.ts`).
- **No j/k, n/p, or next-file/next-hunk keys** in the diff panel.

### 4.2 Fold state
- Collapse one file: header chevron or a click on the header background. Collapse/expand **all** files from the toolbar (`lib/diffCollapse.ts`, "all collapsed" means every **shown** file key is collapsed). Toggle-all also bumps `codeViewRevision`, which remounts the viewer.
- **Default fold**: setting `diffFilesCollapsed`, **default `true`**, so files open **collapsed** (`packages/contracts/src/settings.ts:421`, `DiffPanel.tsx:624-630`). Lazy placeholders are always collapsed.
- Folds are stored per `${environmentId}:${threadId}:${sectionId}` in a **session-only** Zustand store, so they survive switching right panels but reset on reload (`diffPanelStore.ts:183-204`).

### 4.3 Whitespace, wrap, layout
- Whitespace: `diffIgnoreWhitespace`, default **true**. Git scopes refetch with `--ignore-all-space`. For tool-call patches the client strips whitespace and re-diffs each hunk (`lib/diffRendering.ts:79-130`). The toggle changes **local state only** for this panel instance, seeded from the setting (`DiffPanel.tsx:223`).
- Wrap: `wordWrap`, default **true**, also local state seeded from the setting (`:222`).
- Layout stacked/split **writes the global client setting** (`updateClientSettings({ diffLayout })`, `:1149-1154`).

### 4.4 Hide test files
- Global localStorage `t3code.diffHideTestFiles`, default false. The button only appears when at least one test file is present.
- A file is hidden if `classifyChangedFile(path)` is `"tests"` or `"mocks"` (`packages/shared/src/changedFileKind.ts`):
  - **tests**: name matches `/(\.(test|spec|e2e|eval)\.[^.]+$|_(test|spec)\.[^.]+$|^test_.+\.py$|^conftest\.py$|^(vitest|jest)\.setup\.[^.]+$)/i`, or (case-sensitive) `(Tests?|Spec)\.(java|kt|kts|scala|groovy|cs|php|swift|m)$`, or any directory in `__tests__ __test__ cypress e2e evals spec specs test tests`.
  - **mocks**: name matches `/(\.snap$|\.(mocks?|fixtures?|stubs?|fakes?)\.[^.]+$|^(mocks?|fixtures?|stubs?|fakes?)([-_.A-Z]|$))/`, or a directory in `__fixtures__ __mocks__ __snapshots__ fakes fixture fixtures mock mocks stubs testdata`.
  - Generated files (lockfiles, `.min.js`, `generated/`) are checked first and are **not** counted as tests.
- Hiding only affects display; lazy loading still indexes the full list. A file that was asked for from outside stays visible (`DiffPanel.tsx:617-621`). The tree count reflects shown files.

### 4.5 Refresh
Manual refresh button (git scopes). Automatic revalidation on show and on workspace mutations (see §3.7.5). The per-file lazy patches are keyed on the preview input and `diffHash`, so a newer preview refreshes them.

### 4.6 Selection, "Add a comment…", composer chip, agent text
Flow (`components/diffs/AnnotatableCodeView.tsx`):
1. Pierre **line selection** is on (`enableLineSelection`): click or drag over line numbers to select a range, which may cross the additions and deletions sides. Selected lines get a tint `color-mix(code-bg 88% / 80%, … --diffs-modified-base)` and a **4 px accent bar** in the number gutter (`StyledDiffCodeView.tsx:23-78`).
2. Pierre's **gutter utility** "+" button (`enableGutterUtility`) calls `beginComment(range, {item})` when clicked. It builds a draft `ReviewCommentContext` (it gives up if the range cannot be mapped) and places an **annotation** on the range's **end line**, on the end side (`:482-511`). While a draft is open, selection and the gutter "+" are **disabled** (one draft at a time).
3. The draft annotation (`DiffCommentAnnotation.tsx:91-144`) is `px-3 py-2 font-sans`:
   - `Textarea size="sm"`, placeholder **`Add a comment…`**, aria `Comment on lines {rangeLabel}`, auto-focused on the next frame, text direction detected automatically.
   - Footer row: left `text-3xs text-muted-foreground/70` **`⌘/Ctrl Enter to send`**; **`Cancel`** (`ghost-muted xs`); **`Comment`** (primary `xs`, disabled while empty).
4. On submit, `addReviewComment(composerDraftTarget, comment)` (`composerDraftStore.ts:3736-3770`) adds the comment to the thread draft's `reviewComments` and **inserts an inline chip** at the composer caret (if the editor registered an insertion handler), or appends it to the end of the prompt. The draft closes.
5. A posted comment shows inline in the diff (`DiffCommentAnnotation.tsx:60-89`): `border-s-2 border-primary/55 bg-primary/[0.045] px-3 py-2.5`, a `MessageCircle` icon (`text-primary/70`), the text `text-sm leading-5 whitespace-pre-wrap`, and a **Delete comment** trash button that appears on hover (always visible on small screens). Several comments on one line are grouped with `divide-y divide-border/30 border-y border-border/30`. Comments are matched by `sectionId` (scope) and `filePath`, so a comment shows only in the scope where it was made. Deleting it removes it from the draft (and its chip).
6. The draft is gone if its file leaves the list (scope change, `:398-412`).

**ReviewCommentContext** (`reviewCommentContext.ts:15-43`):
`{ id, sectionId, sectionTitle, filePath, startIndex, endIndex, rangeLabel, text, diff, fenceLanguage: "diff", selection: {start, side, end, endSide} }`
- `sectionId` is `branch` / `unstaged` / `commit:{sha}` / `turn:{runId}` / `tool-call:{threadId}:{itemId}`. `sectionTitle` is `Changes` / `Uncommitted` / `Commit …` / `Turn N` / `Tool call` (`DiffPanel.tsx:329-335,428-432`).
- `rangeLabel` (`:435-453`): `+12`, `+12 to +18` (all additions), `-5 to -9` (all deletions), `12 to 18` (mixed or context), `line` / `N lines` as a fallback.
- `diff`: a mini hunk `@@ -a,b +c,d @@` followed by the selected rows with `+` / `-` / space markers. Expanded context is included when the file is not partial (`:497-500`).
- Clamped when the record is built: text at 16 000 chars, diff at 32 000 chars, marker `\n… truncated …` (`packages/contracts/src/composerContext.ts:40-41`, `lib/composerContextRecords.ts:50-56`).

**Chip** (`components/composerContextPresentation.tsx:424-450`, `ContextChip.tsx`):
- Inline text-style chip (no pill background): `inline-flex items-center gap-[0.2em] font-medium`, coloured by `--context-chip-review-comment`, 1 em icon `MessageCircleIcon`.
- Label from `reviewCommentContextLabel` (`lib/composerContextRecords.ts:64-74`): **`{basename} L12`**, **`{basename} L12 to L18`**, with **` (before)`** added for deletion-only ranges. Example: `DiffPanel.tsx L120 to L134`.
- Kind label `Review comment`. The details popover shows the full path, `{sectionTitle} · {rangeLabel}`, the comment as markdown, and a 256 px-high read-only `review.diff` preview of the excerpt.
- In the prompt markdown the chip is stored as `[label](t3-context://v1/review-comment/{contextId})`.

**Exact text sent to the agent** (`packages/shared/src/composerContextReferences.ts:188-198,284-295,316-362`). The chip in the body becomes:
```
[Review comment: DiffPanel.tsx L120 to L134; ref=review-comment_xxxx]
```
and at the end of the message:
```
<t3_context version="1">
<context kind="review-comment" id="review-comment_xxxx">
file: apps/web/src/components/DiffPanel.tsx
range: +120 to +134 (37-51)
section: Changes
comment:
  Why is this a WeakMap?
diff:
  @@ -118,0 +120,15 @@
  +const fileEntryCache = new WeakMap<
  ...
</context>
</t3_context>
```
(`range:` is the raw `rangeLabel` followed by the row indices `(startIndex-endIndex)`. The comment and diff are indented by two spaces. Literal `<t3_context` / `<context` inside the payload are escaped to `&lt;`.)

---

## 5. Persisted state and defaults

| State | Scope | Storage | Default |
|---|---|---|---|
| Scope selection (`branch{baseRef}` / `unstaged` / `commit{sha,baseRef}` / `turn{turnId,filePath,revealRequestId}` / `tool-call{…}`) | **per thread** (`scopedThreadKey`) | localStorage `t3code:diff-panel-state:v1` (v2), Zustand persist (`diffPanelStore.ts:169-179`) | `{kind:"branch", baseRef:null}` = "Changes" against Automatic |
| Remembered base ref (kept when you switch to Uncommitted and back) | per thread | same (`branchBaseRefByThreadKey`) | null (Automatic) |
| A selected turn that disappears | per thread | it is reconciled to the latest turn (`:138-156`) | — |
| File folds | per thread + scope | **session memory only** | `diffFilesCollapsed` setting = **true** (collapsed) |
| Layout stacked/split | global | client setting `diffLayout` | **stacked** |
| Ignore whitespace | global setting seeds per-panel local state | client setting `diffIgnoreWhitespace` | **true** |
| Word wrap | global setting seeds local state | client setting `wordWrap` | **true** |
| File tree open | global | localStorage `t3code.diffFileTreeOpen` | false |
| File tree width | global | `t3code:diff-file-tree-width` | 40% of the row |
| Hide test files | global | localStorage `t3code.diffHideTestFiles` | false |
| Colour scheme | global | client setting `diffColorScheme` `red-green` / `blue-orange` | red-green |
| Review comments | per thread composer draft | composer draft store (persisted with the draft) | — |

---

## 6. Visual details worth copying

**Base tokens** (`index.css:244-247,2274-2277,2289-2302`):
- `--diff-addition: var(--success)` (emerald-500); `--diff-deletion: var(--destructive)` (red-500).
- Text: `--diff-addition-foreground: light-dark(emerald-700, emerald-400)`, `--diff-deletion-foreground: light-dark(red-700, red-400)`.
- The blue-orange scheme (`:root[data-diff-color-scheme="blue-orange"]`) uses blue-600/400 and orange-600/400 for diffs and also re-themes the tree's git colours.

**Surface mixing** (`lib/diffRendering.ts:267-321`). Everything is derived from `--code-background` (which the panel sets to `--background`):
- context row `code-bg 97% + fg`; hover `94%`; separator `95%`; buffer `90%`
- addition row `light-dark(code-bg 50% + addition, code-bg 70% + addition)`; addition line-number cell `light-dark(35%, 60%)` (the number gutter is **stronger** than the row); addition hover `85%`; emphasis `80%`
- deletion: the same percentages with `--diff-deletion`
- token backgrounds are transparent; `--diffs-font-family: var(--font-mono)`, `--diffs-header-font-family: var(--font-sans)`
- Pierre's container has no border or radius, `overflow: clip` (`.diff-render-surface diffs-container`)

**Fonts**: sans is `-apple-system, BlinkMacSystemFont, "Inter Variable", "Segoe UI", system-ui`; mono is `ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono"` (`index.css:171-174`).

**Density**:
- 32 px file headers (12 px sans, counts 11 px mono)
- 24 px hunk separators (11 px sans)
- toolbar 40 px tall with `xs` and `icon-sm` buttons
- tree compact at 0.75 rem
- stat labels `text-2xs`

**Gutters**: Pierre's default number column with `bars` indicators. Selection draws a 4 px `--diffs-modified-base` bar at the start of the number cell. Comment rows have a 2 px primary start border.

**Compact counts**: `DiffStatLabel` uses `formatCompactDiffCount` (`999`, `1.2k`, `12k`, `1.5m`), mono, coloured with the addition/deletion foregrounds. In "aligned" layout it is a `4ch 4ch` grid (`components/chat/DiffStatLabel.tsx`).

---

## 7. Entry points from outside the panel
- Chat turn card "**N changed file(s)**" with `+A -D`, a fold-all-folders button and **`Open diff`** (tooltip `Open the full diff`). It calls `onOpenTurnDiff(runId, firstFilePath)`, which selects the turn and reveals that file (`components/chat/ChangedFilesTree.tsx:60-120`, `useRightPanelActions.ts:300-308`). Clicking a file in the card's tree opens the turn diff at that file.
- A tool-call item's "Open diff" (`V2ItemInspector.tsx:305`) calls `selectToolCall`, which gives the "Tool call" scope.
- A commit link in a PR or chat calls `selectCommit(ref, sha, keepOnOpen)`. Opening the closed pane keeps that selection (`lib/openPullRequestLink.ts:191`, `diffPanelStore.ts:118-137`).

## 8. Gaps and unverified points
- Pierre's built-in strings (hunk separator text such as "N unmodified lines", binary-file placeholder, the exact find-panel UI) live in the `@pierre/diffs` dist. `node_modules` is not installed in `/tmp/t3src`, so they are not quoted here. The same goes for how `@pierre/trees` draws git status (letters or colour only).
- There is no T3-specific binary handling: binary files appear in numstat with 0/0 (`-` becomes 0, `GitVcsDriverCore.ts:217-218`) and render however Pierre renders a binary patch.
- No "Viewed" tracking, no next/previous file or hunk keys, no word-level diff (`lineDiffType: "none"`).
