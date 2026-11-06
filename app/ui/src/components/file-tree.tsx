/**
 * Banda's trees of files, both on `@pierre/trees`, which stays behind
 * them (ADR 0073, decision 3: it is a beta):
 *
 * - `ChangedFiles`, the files of a change, as T3 Code's Diff shows them:
 *   folders open, each file tinted by how it changed (ADR 0034, decision
 *   2);
 * - `FolderTree`, a folder as Files shows it: lazy, one folder listed at a
 *   time as it opens, what git ignores greyed, git's marks, a quiet
 *   spinner on a folder being listed; rows picked with Ctrl or Shift, and
 *   dragged out.
 *
 * Both fold a folder of one folder into its path (`a/b/c`).
 */
import type {
  FileTreeBatchOperation,
  FileTreeDirectoryHandle,
  FileTreeIcons,
  FileTreeItemHandle,
  FileTreeRowDecoration,
  GitStatusEntry,
} from "@pierre/trees"
import { FileTree, useFileTree } from "@pierre/trees/react"
import {
  type CSSProperties,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react"
import { useDark } from "../hooks/use-dark"
import { foldersOf, outermost, pathUpdates } from "../lib/tree-paths"
import { cn } from "../lib/utils"

export type { GitStatus } from "@pierre/trees"

/** A file of the tree, and how it changed. */
export type TreeFile = GitStatusEntry

export type FileTreeProps = {
  files: readonly TreeFile[]
  /** The file shown now, marked in the tree. */
  selected: string | null
  onSelect: (path: string) => void
  className?: string
}

/** A tree drawn again whole when its files change: Pierre's model keeps
 * the paths it was made with. */
export function ChangedFiles(props: FileTreeProps) {
  const key = props.files
    .map((file) => `${file.status}:${file.path}`)
    .join("\n")
  return <Tree key={key} {...props} />
}

function Tree({ files, selected, onSelect, className }: FileTreeProps) {
  const dark = useDark()
  // The model keeps the first handler it is given.
  const chosen = useRef(onSelect)
  useEffect(() => {
    chosen.current = onSelect
  })
  const { model } = useFileTree({
    paths: files.map((file) => file.path),
    gitStatus: files,
    density: "compact",
    flattenEmptyDirectories: true,
    initialExpansion: "open",
    search: false,
    onSelectionChange: (paths) => {
      const path = paths.at(-1)
      if (path && !path.endsWith("/")) chosen.current(path)
    },
    unsafeCSS: CSS,
  })
  useEffect(() => {
    if (selected === null) return
    const item = model.getItem(selected)
    if (item && !model.getSelectedPaths().includes(selected)) {
      for (const path of model.getSelectedPaths())
        model.getItem(path)?.deselect()
      item.select()
      model.scrollToPath(selected)
    }
  }, [model, selected])
  return (
    <FileTree
      model={model}
      className={cn("block h-full min-h-0", className)}
      style={{ colorScheme: dark ? "dark" : "light" }}
    />
  )
}

/** What git says of a file a folder tree shows. */
export type Mark = "modified" | "added" | "deleted" | "renamed" | "untracked"

export type FolderTreeProps = {
  /** Every name it holds, from its top, with `/` between names; a
   * folder's ends with `/`. */
  paths: readonly string[]
  /** It is drawn anew when this changes, as for another folder or the
   * matches of a filter, its folders open as `open` says; else `paths`
   * change it bit by bit. */
  version: string
  /** The folders open as it is drawn anew. */
  open: readonly string[]
  /** git's mark on each file it names; a folder that holds one gets a
   * dot. */
  marks: ReadonlyMap<string, Mark>
  /** What git ignores, greyed, and all a folder of them holds. */
  ignored: readonly string[]
  /** The folders being listed: a quiet spinner on their rows. */
  loading: ReadonlySet<string>
  /** The row picked; it is shown, its folders opened, once it is there. */
  selected: string | null
  /** A row is picked: clicked, or moved to with the keys. */
  onSelect: (path: string) => void
  /** The folders whose names show now, each time they change: a folded
   * chain's own folders too. */
  onOpenChange: (open: string[]) => void
  /** A double click on a row; ↵ is its holder's, as its other keys. */
  onOpen: (path: string) => void
  /** Rows are dragged: the one under the pointer, or every row picked
   * with it. Its holder says what the drag carries, or runs it itself and
   * prevents the page's (`preventDefault`). None: rows do not drag. */
  onDrag?: (paths: string[], event: DragEvent) => void
  /** What a screen reader calls it. */
  label: string
  className?: string
  style?: CSSProperties
  ref?: Ref<FolderTreeHandle>
}

/** What a folder tree's holder may do to it. */
export type FolderTreeHandle = {
  /** Gives it the keys, on the row picked. */
  focus: () => void
  /** Opens these folders, now or as they come. */
  expand: (folders: readonly string[]) => void
  /** Folds every folder. */
  collapse: () => void
  /** The rows picked, from the top. */
  picked: () => string[]
}

/** Pierre's standard icons, in the text's colours, as the look's are. */
const ICONS: FileTreeIcons = {
  set: "standard",
  colored: false,
  spriteSheet: `<svg aria-hidden="true" width="0" height="0" style="position:absolute"><symbol id="banda-tree-loading" viewBox="0 0 16 16"><path d="M8 2a6 6 0 1 0 6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></symbol></svg>`,
}

const LOADING: FileTreeRowDecoration = {
  icon: { name: "banda-tree-loading", width: 12, height: 12 },
  title: "Listing…",
}
const HOLDS: FileTreeRowDecoration = {
  icon: { name: "file-tree-icon-dot", width: 6, height: 6 },
  title: "Holds changes",
}

/** A directory's handle, or none for a file's. */
function folderOf(item: FileTreeItemHandle | null) {
  return item?.isDirectory() ? (item as FileTreeDirectoryHandle) : null
}

/** The row of a tree a press came from, by its path: a right click's,
 * for its holder's menu, which the tree picks first. */
export function rowAt(event: Event): string | null {
  for (const at of event.composedPath()) {
    if (!(at instanceof HTMLElement)) continue
    const path = at.dataset.itemPath
    if (path && at.dataset.type === "item") return path
  }
  return null
}

/** The folders of `marks` that hold one: each folder its paths are in. */
function holding(marks: ReadonlyMap<string, Mark>): Set<string> {
  return new Set([...marks.keys()].flatMap(foldersOf))
}

/** What git's marks and ignores tell Pierre. */
function statusOf(
  marks: ReadonlyMap<string, Mark>,
  ignored: readonly string[]
): GitStatusEntry[] {
  return [
    ...ignored.map((path) => ({ path, status: "ignored" as const })),
    ...[...marks].map(([path, status]) => ({ path, status })),
  ]
}

/** The rows shown, from the top. */
function visibleRows(model: ReturnType<typeof useFileTree>["model"]) {
  const count = model.getVisibleCount()
  return count === 0 ? [] : model.getVisibleRows(0, count - 1)
}

/** The rows picked, from the top, as the tree shows them. */
function pickedOf(model: ReturnType<typeof useFileTree>["model"]): string[] {
  const at = new Map(visibleRows(model).map((row, n) => [row.path, n]))
  return [...model.getSelectedPaths()].sort(
    (a, b) => (at.get(a) ?? 0) - (at.get(b) ?? 0)
  )
}

/** The folders shown open now: each open row's, and the folders a folded
 * chain (`a/b/c`) holds in its one row. */
function openRows(model: ReturnType<typeof useFileTree>["model"]): string[] {
  return visibleRows(model).flatMap((row) => {
    if (row.kind !== "directory" || !row.isExpanded) return []
    const chain = (row.flattenedSegments ?? []).map((one) => one.path)
    return [...chain.filter((path) => path !== row.path), row.path]
  })
}

/**
 * A folder as Files shows it. Its holder lists each folder as it opens
 * and gives the names it found as `paths`; the tree follows what it is
 * given, and says what opens, what is picked and what is opened.
 */
export function FolderTree({
  paths,
  version,
  open,
  marks,
  ignored,
  loading,
  selected,
  onSelect,
  onOpenChange,
  onOpen,
  onDrag,
  label,
  className,
  style,
  ref,
}: FolderTreeProps) {
  const dark = useDark()
  // What the model's handlers read, as they are given once.
  const now = useRef({ onSelect, onOpenChange, onOpen, loading })
  const holds = useRef(holding(marks))
  useEffect(() => {
    now.current = { onSelect, onOpenChange, onOpen, loading }
  })
  // Whether the last press picks rows or lets one go, as Ctrl or Shift
  // with a click or Shift with an arrow: the keys leave the pick as it is.
  const adding = useRef(false)
  const { model } = useFileTree({
    paths,
    initialExpandedPaths: open,
    initialSelectedPaths: selected ? [selected] : [],
    gitStatus: statusOf(marks, ignored),
    density: "compact",
    flattenEmptyDirectories: true,
    initialExpansion: "closed",
    search: false,
    icons: ICONS,
    renderRowDecoration: ({ row }) => {
      if (row.kind !== "directory") return null
      if (row.isExpanded && now.current.loading.has(row.path)) return LOADING
      return holds.current.has(row.path) ? HOLDS : null
    },
    onSelectionChange: (picked) => {
      const path = picked.at(-1)
      if (path) now.current.onSelect(path)
    },
    // Rows drag out of the tree; nothing drops into it yet (step F5).
    dragAndDrop: onDrag ? { canDrop: () => false } : false,
    unsafeCSS: CSS + FOLDER_CSS,
  })

  // The row last asked for and shown.
  const wanted = useRef<string | null>(null)
  // The folders to open once they are there: those `open` names, as the
  // folders above them are listed, and those `expand` asks for.
  const toOpen = useRef(new Set(open))
  const openNow = useCallback(
    (folders: Iterable<string>) => {
      for (const folder of folders) {
        const item = folderOf(model.getItem(folder))
        if (!item) continue
        item.expand()
        toOpen.current.delete(folder)
      }
    },
    [model]
  )

  // The paths it is given: a new version anew, else bit by bit.
  const drawn = useRef({ version, paths })
  useEffect(() => {
    const was = drawn.current
    if (was.version !== version) {
      toOpen.current = new Set(open)
      // The row picked is picked and shown again.
      wanted.current = null
      model.resetPaths(paths, { initialExpandedPaths: open })
    } else if (was.paths !== paths) {
      const updates = pathUpdates(was.paths, paths)
      if (updates.length > 0) model.batch(updates as FileTreeBatchOperation[])
    }
    drawn.current = { version, paths }
    openNow([...toOpen.current])
    // `open` counts only as it is drawn anew.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, version, paths, openNow])

  // git's marks and ignores; the rows draw again with the dots and the
  // spinners besides.
  useEffect(() => {
    holds.current = holding(marks)
    model.setGitStatus(statusOf(marks, ignored))
    model.setComposition(model.getComposition())
  }, [model, marks, ignored, loading])

  // What opens, as the Person opens it or the paths change.
  useEffect(() => {
    let said = ""
    const heard = () => {
      const shown = openRows(model)
      const key = shown.join("\n")
      if (key === said) return
      said = key
      now.current.onOpenChange(shown)
    }
    heard()
    return model.subscribe(heard)
  }, [model])

  // The keys move the pick, as a Finder's do: the row they focus is
  // picked while the tree has the keys.
  useEffect(
    () =>
      model.subscribe(() => {
        const root = model.getFileTreeContainer()?.shadowRoot
        if (!root?.activeElement) return
        // A row pressed among those picked keeps them, to drag them all.
        const focused = model.getFocusedPath()
        const picked = model.getSelectedPaths()
        if (adding.current || !focused || picked.includes(focused)) return
        for (const path of picked) model.getItem(path)?.deselect()
        model.getItem(focused)?.select()
      }),
    [model]
  )

  // The row asked for, once it is there: its folders opened, picked,
  // shown.
  useEffect(() => {
    if (selected === null || selected === wanted.current) return
    const item = model.getItem(selected)
    // Its folders first, as they are listed.
    if (!item) {
      for (const folder of foldersOf(selected)) toOpen.current.add(folder)
      return openNow(foldersOf(selected))
    }
    wanted.current = selected
    if (model.getSelectedPaths().includes(selected)) return
    openNow(foldersOf(selected))
    for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect()
    item.select()
    model.focusPath(selected)
    model.scrollToPath(selected, { offset: "center", focus: false })
  }, [model, selected, paths, openNow])

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        const path = model.getSelectedPaths().at(-1) ?? model.getFocusedPath()
        if (path) model.scrollToPath(path, { focus: true })
        else model.focusFirstItem()
        const root = model.getFileTreeContainer()?.shadowRoot
        const row = root?.querySelector<HTMLElement>('[tabindex="0"]')
        row?.focus()
      },
      expand: (folders) => {
        for (const folder of folders) toOpen.current.add(folder)
        openNow(folders)
      },
      collapse: () => {
        for (const path of drawn.current.paths)
          if (path.endsWith("/")) folderOf(model.getItem(path))?.collapse()
      },
      picked: () => pickedOf(model),
    }),
    [model, openNow]
  )

  return (
    <div
      className={cn("h-full min-h-0", className)}
      onPointerDownCapture={(event) => {
        adding.current = event.ctrlKey || event.metaKey || event.shiftKey
      }}
      onKeyDownCapture={(event) => {
        adding.current = event.shiftKey
      }}
      onDragStart={(event) => {
        const path = rowAt(event.nativeEvent)
        if (!path || !onDrag) return
        const picked = pickedOf(model)
        onDrag(
          picked.includes(path) ? outermost(picked) : [path],
          event.nativeEvent
        )
        // A drag its holder runs itself never starts here: the tree's own
        // ends now, as it would with the page's.
        if (event.defaultPrevented) window.dispatchEvent(new Event("dragend"))
      }}
      onDoubleClick={(event) => {
        const path = rowAt(event.nativeEvent)
        if (path) onOpen(path)
      }}
      onContextMenu={(event) => {
        const path = rowAt(event.nativeEvent)
        if (!path) return
        if (!model.getSelectedPaths().includes(path)) {
          for (const one of model.getSelectedPaths())
            model.getItem(one)?.deselect()
          model.getItem(path)?.select()
        }
        model.focusPath(path)
      }}
    >
      <FileTree
        model={model}
        aria-label={label}
        className="block h-full min-h-0"
        style={{ colorScheme: dark ? "dark" : "light", ...style }}
      />
    </div>
  )
}

const CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-fg-override: var(--foreground);
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-bg-muted-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 0.75rem;
    --trees-git-added-color-override: var(--added);
    --trees-git-deleted-color-override: var(--removed);
  }
  [data-truncate-content='visible'] { overflow: hidden; text-overflow: ellipsis; }
  [data-truncate-marker] { display: none; }
  button[data-type='item'], button[data-type='item']::before { border-radius: calc(var(--radius) - 4px); }
`

/** A folder tree's own: git's colours from Banda's palette, what git
 * ignores in the muted text, a folder's dot as a decoration of ours (Pierre
 * counts an ignored file as a change it holds), and the spinner. */
const FOLDER_CSS = `
  :host {
    --trees-git-modified-color-override: var(--warning);
    --trees-git-renamed-color-override: var(--warning);
    --trees-git-untracked-color-override: var(--added);
    --trees-git-ignored-color-override: color-mix(in srgb, var(--muted-foreground) 70%, transparent);
    --trees-focus-ring-color-override: color-mix(in srgb, var(--ring) 60%, transparent);
    --trees-selected-focused-border-color-override: color-mix(in srgb, var(--ring) 60%, transparent);
  }
  [data-item-type='folder'] > [data-item-section='git'] { display: none; }
  [data-item-type='folder'] > [data-item-section='decoration'] { padding-inline-end: 3px; }
  [data-item-type='folder'] > [data-item-section='decoration'] { color: var(--trees-git-modified-color); fill: currentColor; }
  [data-item-type='folder'] [data-icon-name='file-tree-icon-dot'] { opacity: .6; }
  [data-item-git-status='ignored'] > [data-item-section='content'] { opacity: .85; }
  svg[data-icon-name='banda-tree-loading'] { opacity: .6; }
  @media (prefers-reduced-motion: no-preference) {
    svg[data-icon-name='banda-tree-loading'] { animation: banda-tree-spin 1s linear infinite; }
  }
  @keyframes banda-tree-spin { to { transform: rotate(360deg); } }
`
