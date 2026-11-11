/**
 * Banda's trees of files, both on `@pierre/trees`, which stays behind
 * them (ADR 0073, decision 3: it is a beta):
 *
 * - `ChangedFiles`, the files of a change, as T3 Code's Diff shows them:
 *   folders open, each file tinted by how it changed (ADR 0034, decision
 *   2);
 * - `FolderTree`, a folder as Files shows it: lazy, one folder listed at a
 *   time as it opens, what git ignores greyed, git's marks, a quiet dot on
 *   what an Agent's turn changed, the row of the file an Agent works on
 *   now pulsing in its colour, a quiet spinner on a folder being listed;
 *   rows picked with Ctrl or Shift, dragged out, and dropped on a folder;
 *   a row renamed in place, its name before its extension picked; a
 *   picture's small picture in place of its icon, when asked;
 * - `ListedTree`, names all known at once, as an archive's, each with a
 *   quiet word at its end, as its size; it only shows.
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
  useState,
} from "react"
import { useDark } from "../hooks/use-dark"
import type { ProjectFile } from "@banda/core"
import { bringsFiles, dropEffectOf, droppedFiles } from "../lib/file-drag"
import { toast } from "./sonner"
import { holding, pulseCSS, type RowMark, rowMarkOf } from "../lib/tree-marks"
import {
  foldersOf,
  movedPaths,
  outermost,
  pathUpdates,
} from "../lib/tree-paths"
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

export type ListedTreeProps = {
  /** Every name, from the top, `/` between names; a folder's ends with
   * `/`. A folder only named in its files' paths is there too. */
  paths: readonly string[]
  /** A quiet word at a row's end, by its path, as a file's size. */
  notes?: ReadonlyMap<string, string>
  /** Every folder open as it is drawn, or only those at the top. */
  open: "all" | "top"
  /** A row is picked. */
  onSelect?: (path: string) => void
  /** What a screen reader calls it. */
  label: string
  className?: string
}

/** Names all known at once, drawn anew when they change: Pierre's model
 * keeps the paths it was made with. */
export function ListedTree(props: ListedTreeProps) {
  return <Listed key={props.paths.join("\n")} {...props} />
}

function Listed({
  paths,
  notes,
  open,
  onSelect,
  label,
  className,
}: ListedTreeProps) {
  const dark = useDark()
  const chosen = useRef(onSelect)
  useEffect(() => {
    chosen.current = onSelect
  })
  const { model } = useFileTree({
    paths,
    density: "compact",
    flattenEmptyDirectories: true,
    initialExpansion: open === "all" ? "open" : "closed",
    search: false,
    icons: ICONS,
    renderRowDecoration: ({ row }) => {
      const text = notes?.get(row.path)
      return text ? { text } : null
    },
    onSelectionChange: (picked) => {
      const path = picked.at(-1)
      if (path) chosen.current?.(path)
    },
    unsafeCSS: CSS,
  })
  return (
    <FileTree
      model={model}
      aria-label={label}
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
  /** The files an Agent's turn changed: a quiet dot on each, and on each
   * folder that holds one (ADR 0073, decision 3). */
  turned?: ReadonlySet<string>
  /** The files Agents work on now, each with its Agent's colour, a CSS
   * colour: their rows pulse in it (ADR 0073, decision 9). */
  pulses?: ReadonlyMap<string, string>
  /** What git ignores, greyed, and all a folder of them holds. */
  ignored: readonly string[]
  /** The folders being listed: a quiet spinner on their rows. */
  loading: ReadonlySet<string>
  /** Small pictures drawn in place of rows' icons, by their paths, each
   * an address an image is drawn from (ADR 0073, step F6). */
  pictures?: ReadonlyMap<string, string>
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
  /** A row renamed in place, from its path to its new one: whether its
   * holder renamed it; else it goes back. None: no row is renamed. */
  onRename?: (from: string, to: string) => Promise<boolean>
  /** Banda's files dropped on a folder of the tree, `""` its top, each
   * with its Project: copied when Alt (⌥) or Ctrl is held as they drop,
   * else moved. None: nothing drops on it. */
  onDrop?: (files: readonly ProjectFile[], dir: string, copy: boolean) => void
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
  /** Renames the row in place: its name before its extension is picked,
   * or all of it with `whole`. Whether it could. */
  rename: (path: string, whole?: boolean) => boolean
  /** Shows a row at once, before its folder is listed again. */
  add: (path: string) => void
}

/** Pierre's standard icons, in the text's colours, as the look's are. */
const ICONS: FileTreeIcons = {
  set: "standard",
  colored: false,
  spriteSheet: `<svg aria-hidden="true" width="0" height="0" style="position:absolute"><symbol id="banda-tree-loading" viewBox="0 0 16 16"><path d="M8 2a6 6 0 1 0 6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></symbol><symbol id="banda-tree-turn" viewBox="0 0 6 6"><circle cx="3" cy="3" r="2.5" fill="currentColor"/></symbol><symbol id="banda-tree-both" viewBox="0 0 14 6"><circle cx="3" cy="3" r="2.5" fill="currentColor"/><circle cx="11" cy="3" r="2.5" style="fill:var(--banda-turn-dot)"/></symbol></svg>`,
}

const LOADING: FileTreeRowDecoration = {
  icon: { name: "banda-tree-loading", width: 12, height: 12 },
  title: "Listing…",
}
const HOLDS: FileTreeRowDecoration = {
  icon: { name: "file-tree-icon-dot", width: 6, height: 6 },
  title: "Holds changes",
}
const TURNED: FileTreeRowDecoration = {
  icon: { name: "banda-tree-turn", width: 5, height: 5 },
  title: "Changed by the Agent's turn",
}
const HOLDS_TURNED: FileTreeRowDecoration = {
  icon: { name: "banda-tree-turn", width: 5, height: 5 },
  title: "Holds what the Agent's turn changed",
}
const HOLDS_BOTH: FileTreeRowDecoration = {
  icon: { name: "banda-tree-both", width: 14, height: 6 },
  title: "Holds changes, some of them the Agent's turn's",
}

const NO_TURN: ReadonlySet<string> = new Set()
const NO_PULSES: ReadonlyMap<string, string> = new Map()

/** The rows of `pictures` drawn with their small pictures in place of
 * their icons, by a sheet of the tree's own. */
function picturesCSS(pictures: ReadonlyMap<string, string>): string {
  return [...pictures]
    .map(([path, picture]) => {
      const icon = `button[data-type='item'][data-item-path="${path.replace(/["\\]/g, "\\$&")}"] [data-item-section='icon']`
      const address = picture.replace(/["\\\n]/g, "")
      return `${icon} > svg { visibility: hidden; } ${icon} { background: center / cover no-repeat url("${address}"); border-radius: var(--small-radius); }`
    })
    .join("\n")
}

/** Each mark of a row as Pierre draws it. */
const DECORATIONS: Record<RowMark, FileTreeRowDecoration> = {
  loading: LOADING,
  holds: HOLDS,
  turned: TURNED,
  "holds-turned": HOLDS_TURNED,
  "holds-both": HOLDS_BOTH,
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

/** The folder a drop at `event` goes in: the folder row under it, or the
 * folder of the file under it; `""`, the top, elsewhere. */
function dropFolderAt(event: Event): string {
  for (const at of event.composedPath()) {
    if (!(at instanceof HTMLElement)) continue
    const chain = at.dataset.itemFlattenedSubitem
    if (chain?.endsWith("/")) return chain
    if (at.dataset.type !== "item") continue
    if (at.dataset.itemType === "folder") return at.dataset.itemPath ?? ""
    const parent = at.dataset.itemParentPath ?? ""
    return parent && !parent.endsWith("/") ? `${parent}/` : parent
  }
  return ""
}

/** How a folder a drop would go in is lit, by a sheet of the tree's own. */
function dropCSS(folder: string | null): string {
  if (folder === null) return ""
  if (folder === "")
    return ":host { outline: 1px solid color-mix(in srgb, var(--ring) 70%, transparent); outline-offset: -1px; border-radius: var(--control-radius); }"
  return `button[data-item-path="${globalThis.CSS.escape(folder)}"] { background: color-mix(in srgb, var(--ring) 22%, transparent) !important; }`
}

/** A sheet of the tree's own, by its name, put in its shadow root once
 * the tree has one. Returns how to stop waiting for it. */
function putSheet(
  model: ReturnType<typeof useFileTree>["model"],
  name: string,
  css: string
): () => void {
  let frame = 0
  const put = () => {
    const root = model.getFileTreeContainer()?.shadowRoot
    if (!root) {
      frame = requestAnimationFrame(put)
      return
    }
    let sheet = root.querySelector<HTMLStyleElement>(`style[data-${name}]`)
    if (!sheet) {
      sheet = document.createElement("style")
      sheet.setAttribute(`data-${name}`, "")
      root.append(sheet)
    }
    sheet.textContent = css
  }
  put()
  return () => cancelAnimationFrame(frame)
}

/** Notes in `drawn` a row the model moved itself, from `from` to `to`. */
function movedIn(
  drawn: { current: { version: string; paths: readonly string[] } },
  from: string,
  to: string
): void {
  drawn.current = {
    ...drawn.current,
    paths: movedPaths(drawn.current.paths, from, to),
  }
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
  turned = NO_TURN,
  pulses = NO_PULSES,
  pictures = NO_PULSES,
  ignored,
  loading,
  selected,
  onSelect,
  onOpenChange,
  onOpen,
  onDrag,
  onRename,
  onDrop,
  label,
  className,
  style,
  ref,
}: FolderTreeProps) {
  const dark = useDark()
  // What the model's handlers read, as they are given once.
  const now = useRef({ onSelect, onOpenChange, onOpen, onRename, loading })
  const decorating = useRef({
    holds: holding(marks.keys()),
    turned,
    turnHolds: holding(turned),
  })
  useEffect(() => {
    now.current = { onSelect, onOpenChange, onOpen, onRename, loading }
  })
  // Whether the last press picks rows or lets one go, as Ctrl or Shift
  // with a click or Shift with an arrow: the keys leave the pick as it is.
  const adding = useRef(false)
  // The paths the model holds, as it was given them or moved them itself.
  const drawn = useRef({ version, paths })
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
      const mark = rowMarkOf(row.path, row.kind === "directory", {
        loading: row.isExpanded && now.current.loading.has(row.path),
        ...decorating.current,
      })
      return mark && DECORATIONS[mark]
    },
    onSelectionChange: (picked) => {
      const path = picked.at(-1)
      if (path) now.current.onSelect(path)
    },
    // Rows drag out of the tree, and back onto it as files: its holder
    // runs the drag, and the drop, never Pierre's model.
    dragAndDrop: onDrag ? { canDrop: () => false } : false,
    // Pierre moves the row as it is renamed; its holder renames the file,
    // or it goes back.
    renaming: {
      canRename: () => now.current.onRename !== undefined,
      // What Pierre refuses before it asks: a name taken, or none.
      onError: (error) =>
        toast.warning(
          /already exists/.test(error)
            ? "That name is already there."
            : error.replace(/^Name/, "A name")
        ),
      onRename: ({ sourcePath, destinationPath, isFolder }) => {
        const slash = isFolder ? "/" : ""
        const [from, to] = [sourcePath + slash, destinationPath + slash]
        movedIn(drawn, from, to)
        void now.current.onRename?.(from, to).then((done) => {
          if (done || !model.getItem(to) || model.getItem(from)) return
          model.move(to, from)
          movedIn(drawn, to, from)
        })
      },
    },
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

  // The paths it is given: a new version anew, else bit by bit, from the
  // paths the model holds, which a rename in place and a row shown early
  // change too.
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

  // git's marks and ignores; the rows draw again with the dots, the
  // turn's and the spinners besides.
  useEffect(() => {
    decorating.current = {
      holds: holding(marks.keys()),
      turned,
      turnHolds: holding(turned),
    }
    model.setGitStatus(statusOf(marks, ignored))
    model.setComposition(model.getComposition())
  }, [model, marks, turned, ignored, loading])

  // The rows Agents work on pulse, by a sheet of the tree's own.
  useEffect(() => putSheet(model, "pulses", pulseCSS(pulses)), [model, pulses])
  // Rows with small pictures show them.
  useEffect(
    () => putSheet(model, "pictures", picturesCSS(pictures)),
    [model, pictures]
  )

  // The folder a drag over the tree would drop in, lit.
  const [dropping, setDropping] = useState<string | null>(null)
  useEffect(() => putSheet(model, "drop", dropCSS(dropping)), [model, dropping])

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
    // Its folders open, as when it was picked as the tree was made.
    openNow(foldersOf(selected))
    if (model.getSelectedPaths().includes(selected)) return
    // Picked and focused before the others are let go: while the tree has
    // the keys, the row they are on would be picked again as it is let go,
    // and stay picked with this one.
    item.select()
    model.focusPath(selected)
    for (const path of model.getSelectedPaths())
      if (path !== selected) model.getItem(path)?.deselect()
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
      rename: (path, whole = false) => {
        if (!model.startRenaming(path)) return false
        // Pierre picks the whole name as its field takes the keys; then a
        // file's extension is left out of it, as a Finder does.
        const name = path.replace(/\/$/, "").split("/").at(-1) ?? ""
        const dot = path.endsWith("/") || whole ? -1 : name.lastIndexOf(".")
        let frames = 30
        const pick = () => {
          const root = model.getFileTreeContainer()?.shadowRoot
          const field = root?.querySelector<HTMLInputElement>(
            "[data-item-rename-input]"
          )
          if (field && root?.activeElement === field)
            field.setSelectionRange(0, dot)
          else if (--frames > 0) requestAnimationFrame(pick)
        }
        if (dot > 0) requestAnimationFrame(pick)
        return true
      },
      add: (path) => {
        if (model.getItem(path)) return
        model.add(path)
        drawn.current = {
          ...drawn.current,
          paths: [...drawn.current.paths, path],
        }
      },
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
      onDragOver={(event) => {
        if (!onDrop || !bringsFiles(event.dataTransfer)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = dropEffectOf(
          event.dataTransfer,
          event.altKey || event.ctrlKey
        )
        setDropping(dropFolderAt(event.nativeEvent))
      }}
      onDragLeave={(event) => {
        const into = event.relatedTarget
        if (!(into instanceof Node) || !event.currentTarget.contains(into))
          setDropping(null)
      }}
      onDrop={(event) => {
        setDropping(null)
        if (!onDrop) return
        const files = droppedFiles(event.dataTransfer)
        if (!files) return
        event.preventDefault()
        onDrop(
          files,
          dropFolderAt(event.nativeEvent),
          event.altKey || event.ctrlKey
        )
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
  button[data-type='item'], button[data-type='item']::before { border-radius: var(--control-radius); }
`

/** A folder tree's own: git's colours from Banda's palette, what git
 * ignores in the muted text, a folder's dot as a decoration of ours (Pierre
 * counts an ignored file as a change it holds), the turn's quiet dot, the
 * spinner, and the pulse an Agent's file wears. */
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
  :host { --banda-turn-dot: color-mix(in srgb, var(--muted-foreground) 85%, transparent); }
  svg[data-icon-name='banda-tree-turn'] { color: var(--banda-turn-dot); }
  [data-item-type='folder'] svg[data-icon-name='banda-tree-both'] { opacity: .8; }
  @keyframes banda-pulse {
    from { box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--banda-pulse) 65%, transparent); }
    to { box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--banda-pulse) 10%, transparent); }
  }
  @media (prefers-reduced-motion: reduce) {
    button[data-type='item'] { animation-play-state: paused !important; }
  }
  [data-item-git-status='ignored'] > [data-item-section='content'] { opacity: .85; }
  svg[data-icon-name='banda-tree-loading'] { opacity: .6; }
  @media (prefers-reduced-motion: no-preference) {
    svg[data-icon-name='banda-tree-loading'] { animation: banda-tree-spin 1s linear infinite; }
  }
  @keyframes banda-tree-spin { to { transform: rotate(360deg); } }
`
