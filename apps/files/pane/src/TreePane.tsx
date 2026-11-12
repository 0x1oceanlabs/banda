/**
 * `files.tree`: any folder as a Finder shows it (ADR 0073, decisions 1
 * and 3), the default view being a tree. The places on its left, its path
 * above, and the tree under it: lazy, a folder listed as it opens; what
 * git ignores greyed; dotfiles shown or not, by the Pane; git's marks
 * where the folder is in the Project's repository; and a filter that
 * finds as one types. It follows the folders it shows open on disk.
 *
 * ↵ or a double click opens a file beside it, in `files.file`, or goes
 * into a folder. Space shows the row picked in Quick Look, over the desk,
 * and the arrows move it there while the tree keeps the keys (step F3).
 * Its rows, one or the several picked, go into a Thread's message by
 * their menu or a drag, and out to other apps as the files (step F2).
 *
 * It does what a Finder does with them (decision 10, step F5): makes a
 * file or a folder, renames in place (F2), duplicates, copies, cuts and
 * pastes, moves a row dragged onto a folder, and moves to the Trash, each
 * said in a toast with Undo, and undone by Ctrl+Z too. Several rows are
 * renamed as text. Ctrl+Shift+F finds words in its files, and its Trash
 * place lists the system's Trash.
 *
 * The Agents' work shows on it (decisions 3 and 9): the row of the file
 * each running turn works on pulses in its Agent's colour, and a quiet
 * dot sits on what the turn of its Thread changed. Follow, off at first,
 * moves the pick and the file it opened to the file that Agent works on.
 *
 * It shows its folder three ways over one pick (decision 3, step F6): the
 * tree, Columns, or a Gallery, by Ctrl+1, 2 and 3 or its header; and the
 * info of the row picked beside it, by Ctrl+I. Its keys are the actions of
 * its scope, `files`, its whole tile (ADR 0071): the window matches them,
 * and the Pane runs them where its view, or one of its fields, has the
 * focus.
 */
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { Engine, ProjectId } from "@banda/contract"
import { FILES_FILE, type Making } from "@banda/contract/files"
import type { DeviceFile, ProjectFile } from "@banda/core/react"
import { Button } from "@banda/ui/components/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@banda/ui/components/context-menu"
import {
  FolderTree,
  type FolderTreeHandle,
  type Mark,
  rowAt,
} from "@banda/ui/components/file-tree"
import { InHeader } from "@banda/ui/components/pane-header"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { type Handler, useScope } from "@banda/ui/hooks/use-scope"
import { toast } from "@banda/ui/components/sonner"
import { Spinner } from "@banda/ui/components/spinner"
import { useHarnesses } from "@banda/ui/hooks/use-harnesses"
import { useProjects } from "@banda/ui/hooks/use-projects"
import { useRead } from "@banda/ui/hooks/use-read"
import { useWiderThan } from "@banda/ui/hooks/use-wider-than"
import { dragFiles } from "@banda/ui/lib/file-drag-out"
import { FIELDS } from "@banda/ui/lib/keys"
import { useFile } from "@banda/ui/lib/look"
import { holding as holdingFolders } from "@banda/ui/lib/tree-marks"
import { cn } from "@banda/ui/lib/utils"
import { shownProjects } from "@banda/ui/lib/projects"
import type { WindowApi } from "@banda/ui/module"
import { definePane, type PaneProps, paneOf } from "@banda/ui/pane"
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  Columns3Icon,
  EyeIcon,
  EyeOffIcon,
  FolderTreeIcon,
  FolderXIcon,
  GalleryThumbnailsIcon,
  InfoIcon,
  ListTreeIcon,
  LocateFixedIcon,
  PanelLeftIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import {
  colourOf,
  followsAt,
  nextTarget,
  pulsesOf,
  type Target,
  threadOf,
  touchOf,
  turnedIn,
  wholeFrom,
} from "./agent"
import * as acts from "./acts"
import { BulkRename } from "./BulkRename"
import type { Named } from "./bulk"
import { useClashes } from "./ClashDialog"
import { keep, kept, pasted } from "./clip"
import { Columns } from "./Columns"
import { Card } from "./Facts"
import { useFolder } from "./folder"
import { Gallery } from "./Gallery"
import { HeaderButton } from "./HeaderButton"
import { InfoPane } from "./Info"
import { type Does, FILES, idOf, KEYS, takes, typesFilter } from "./keys"
import { marksOf } from "./marks"
import { PathBar } from "./PathBar"
import { Rail } from "./Rail"
import { RecentList } from "./RecentList"
import { useThreads, useTouched, useTurned } from "./live"
import { MakeItems, RowMenu } from "./RowMenu"
import { SearchView } from "./SearchView"
import { TrashList } from "./TrashList"
import { Look } from "./Preview"
import { isPicture, useThumbs } from "./thumbs"
import {
  ahead,
  matchesOf,
  onlyFolder,
  type Showing,
  treeOf,
  untitled,
} from "./tree"
import type { RowMarks, ViewEvents } from "./ViewParts"
import {
  entryOf,
  listedFor,
  parentRow,
  type View,
  VIEWS,
  viewOf,
} from "./views"
import {
  localOf,
  nameOf,
  parentOf,
  tilded,
  untilded,
  wholeOf,
  within,
} from "./where"
import { holding, moveFile, workedAt, workedIn } from "./work"
import { peeked } from "./peek"
import type { Undoable } from "./undo"

export type TreeArgs = {
  /** The folder, whole; `""` is the Project's, which it names once read. */
  dir: string
  /** The folders open, from it, each ending with `/`. */
  open?: string[]
  /** The row picked, from it. */
  selected?: string | null
  /** Whether it shows dotfiles; `files.toml`'s choice when left out. */
  hidden?: boolean
  /** Whether its places show in full; folded on a narrow Pane when left
   * out. */
  rail?: boolean
  /** It shows Recent, not the folder. */
  recent?: boolean
  /** It shows the system's Trash, not the folder. */
  trash?: boolean
  /** Its pick and the file it opened follow the Agent's file. */
  follow?: boolean
  /** The Thread it was opened from: whose turns it marks and follows. */
  thread?: string
  /** How it shows its folder: the tree when left out. */
  view?: View
  /** It shows the info of the row picked beside it. */
  info?: boolean
}

export const treePane = definePane<TreeArgs>({
  kind: "files.tree",
  title: (args) =>
    args.recent ? "Recent" : args.trash ? "Trash" : nameOf(args.dir) || "Files",
  detail: (args) => (args.recent || args.trash ? null : args.dir || null),
  icon: FolderTreeIcon,
  // The launcher's Files: the Project's folder.
  start: { dir: "" },
  letter: "F",
  narrow: true,
  // One to go back to in a Project: the Banda menu's Files and "Show in
  // Files" find it again.
  identity: () => "files",
  // Another machine's folders, on that machine's engine: every read and
  // act here goes through the Pane's session (ADR 0106, step 3b).
  elsewhere: true,
  Pane: TreePane,
})

/** Opens Files on `args` beside the focused Pane, in `project`; the one
 * shown already goes there, with `update`, or gets the focus as it is. */
export function openTree(
  window: WindowApi,
  args: TreeArgs,
  project?: ProjectId,
  update = false
): void {
  window.open(paneOf(treePane, args), project, {
    again: false,
    ...(update && { update: true }),
  })
}

/** Under this width a Pane folds its places to icons, in px. */
const NARROW = 480
/** How long the open folders and the pick rest before they are kept, in
 * ms. */
const KEEP = 400
/** The most open folders kept with the Pane. */
const KEPT_OPEN = 200
/** How often Follow looks again while the Person holds something, in ms. */
const LOOK_AGAIN = 1_000
/** How long the filter's words rest before they are looked for, in ms. */
const WAIT = 80
/** The most matches the filter shows. */
const MATCHES = 200
/** The most folders Expand all opens. */
const EXPANDED = 300

const NO_MARKS: ReadonlyMap<string, Mark> = new Map()
const NO_WRITES: string[] = []

/** How many rows of the tree show their small pictures at most. */
const PICTURED = 200

/** Whether a Pane shows the info of its pick: Columns do, under their
 * preview, unless the Pane said otherwise. */
const infoIn = (args: TreeArgs) => args.info ?? viewOf(args.view) === "columns"

function TreePane(props: PaneProps<TreeArgs>) {
  const { engine, project, args, update, label, device, file } = props
  const places = useRead(
    useCallback(
      () => engine.call("files.places", {}, { project }),
      [engine, project]
    )
  )
  const home = places.state === "ready" ? places.value.home : null
  // The Project's folder, as the engine finds it.
  const top = useRead(
    useCallback(
      () => engine.call("files.stat", { paths: [""] }, { project }),
      [engine, project]
    )
  )
  const projectTop = top.state === "ready" ? (top.value[0]?.path ?? null) : null
  const finder = useFile(FILES_FILE)
  const { listed: projects } = useProjects(engine)

  // `""` is the Project's folder: named once it is read.
  useEffect(() => {
    if (args.dir === "" && projectTop) update({ ...args, dir: projectTop })
  }, [args, projectTop, update])

  const box = useRef<HTMLDivElement>(null)
  const wide = useWiderThan(box, NARROW)
  const railOpen = args.rail ?? wide
  const hidden = args.hidden ?? finder.hidden
  // The same between draws: the tree's paths are worked out again only as
  // a folder is listed again, or this changes. Paths from before drawn
  // again, as the args are kept, would take back the row a New file shows
  // early, its name's field with it, and a rename in place.
  const showing = useMemo(
    () => ({ hidden, ignored: finder.ignored }),
    [hidden, finder.ignored]
  )
  const recent = args.recent === true
  const trash = args.trash === true && !recent
  const dir = args.dir

  // Its header names the folder with ~ for home.
  useEffect(() => {
    if (recent || trash || !dir) label?.(null)
    else label?.({ title: nameOf(dir), detail: tilded(dir, home) })
  }, [label, recent, trash, dir, home])

  // Another folder, its folders folded; out of Recent and the Trash.
  const go = useCallback(
    (to: string, selected: string | null = null) =>
      update({
        ...args,
        dir: to,
        open: [],
        selected,
        recent: false,
        trash: false,
      }),
    [update, args]
  )
  /** Goes to a path typed: a folder, or a file's folder with it picked. */
  const goTyped = useCallback(
    async (path: string): Promise<string | null> => {
      const [stat] = await engine
        .call("files.stat", { paths: [path] }, { project })
        .catch(() => [null])
      if (!stat) return `${tilded(path, home)} is not there.`
      if (stat.kind === "folder") go(path)
      else go(parentOf(path) ?? "/", nameOf(path))
      return null
    },
    [engine, project, home, go]
  )
  const openFile = useCallback(
    (whole: string) =>
      props.run?.("files.open", { file: whole, line: null, project }),
    [props, project]
  )
  // Each named in a Thread's message, a folder with its `/`.
  const attach = useCallback(
    (wholes: readonly string[]) => {
      for (const file of wholes) props.run?.("file.attach", { file, project })
    },
    [props, project]
  )
  const pin = useCallback(
    (whole: string, on: boolean) =>
      props.run?.("files.pin", { dir: tilded(whole, home), pin: on }),
    [props, home]
  )
  // Pins are this device's, in its files.toml, until 5b: another
  // machine's Files shows that machine's places and none of these (ADR
  // 0106, decision 5, call 9 A).
  const here = localOf(device, file, dir || "/") !== undefined
  const pinned = useMemo(
    () =>
      here ? finder.pinned.map((place) => untilded(place, home, "/")) : [],
    [here, finder.pinned, home]
  )
  const local = useCallback(
    (whole: string) => localOf(device, file, whole),
    [device, file]
  )

  const shownList = useMemo(
    () => (projects.state === "ready" ? shownProjects(projects.value) : []),
    [projects]
  )

  return (
    <div ref={box} className="flex h-full min-h-0">
      <InHeader>
        <HeaderButton
          label="Places"
          on={railOpen}
          onClick={() => update({ ...args, rail: !railOpen })}
        >
          <PanelLeftIcon />
        </HeaderButton>
      </InHeader>
      <Rail
        folded={!railOpen}
        projects={shownList}
        places={places.state === "ready" ? places.value : null}
        pinned={pinned}
        at={recent || trash ? null : dir}
        recent={recent}
        trash={trash}
        onGo={(to) => go(to)}
        onRecent={() => update({ ...args, recent: true, trash: false })}
        onTrash={() => update({ ...args, trash: true, recent: false })}
        onUnpin={(place) => pin(place, false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {trash ? (
          <TrashList
            engine={engine}
            project={project}
            home={home}
            local={local}
          />
        ) : recent ? (
          <>
            <div className="flex h-8 shrink-0 items-center border-b px-2.5 text-xs">
              Recent
            </div>
            <div className="min-h-0 flex-1">
              <RecentList
                engine={engine}
                project={project}
                home={home}
                top={projectTop}
                onOpen={openFile}
                onShow={(whole) => go(parentOf(whole) ?? "/", nameOf(whole))}
                onAttach={(whole) => attach([whole])}
                local={local}
              />
            </div>
          </>
        ) : dir === "" ? (
          <Loading />
        ) : (
          <FolderView
            key={dir}
            {...props}
            home={home}
            projectTop={projectTop}
            showing={showing}
            thumbnails={finder.thumbnails}
            pinned={pinned}
            onGo={go}
            onGoTyped={goTyped}
            onOpenFile={openFile}
            onAttach={attach}
            onPin={here ? pin : undefined}
            local={local}
          />
        )}
      </div>
    </div>
  )
}

type FolderViewProps = PaneProps<TreeArgs> & {
  home: string | null
  projectTop: string | null
  showing: Showing
  /** The tree's rows show their small pictures (files.toml). */
  thumbnails: boolean
  pinned: readonly string[]
  onGo: (dir: string, selected?: string | null) => void
  onGoTyped: (path: string) => Promise<string | null>
  onOpenFile: (whole: string) => void
  onAttach: (wholes: readonly string[]) => void
  /** None on another machine, whose pins wait for its settings (5b). */
  onPin?: (whole: string, on: boolean) => void
  /** A whole path as this computer holds it; none for another machine's. */
  local: (whole: string) => DeviceFile | undefined
}

/** One folder: its path, its tree, and what the filter found in it. */
function FolderView({
  engine,
  project,
  args,
  update,
  focused,
  run,
  device,
  file,
  home,
  projectTop,
  showing,
  thumbnails,
  pinned,
  onGo,
  onGoTyped,
  onOpenFile,
  onAttach,
  onPin,
  local,
}: FolderViewProps) {
  const dir = args.dir
  const keyLabel = useKeyLabel()
  // Its args as last changed here: keys pressed before the Pane draws
  // again each change them on from the one before.
  const now = useRef(args)
  useEffect(() => {
    now.current = args
  }, [args])
  const change = useCallback(
    (more: Partial<TreeArgs>) => {
      now.current = { ...now.current, ...more }
      update(now.current)
    },
    [update]
  )
  /** A row's whole path, a folder's with its `/`, as a message names it. */
  const named = useCallback(
    (path: string) => wholeOf(dir, path) + (path.endsWith("/") ? "/" : ""),
    [dir]
  )
  const tree = useRef<FolderTreeHandle>(null)
  const area = useRef<HTMLDivElement>(null)
  const filterField = useRef<HTMLInputElement>(null)
  // The file this tree opened last, which Follow moves.
  const opened = useRef<string | null>(null)

  // The folders open and the row picked, as the tree says them; kept
  // with the Pane once they rest.
  const [open, setOpen] = useState<readonly string[]>(args.open ?? [])
  const [picked, setPicked] = useState<string | null>(args.selected ?? null)
  // A pick the args bring from elsewhere, as "Show in Files": taken, but
  // not the Pane's own coming back.
  const asked = args.selected ?? null
  const [seen, setSeen] = useState(asked)
  const [sent, setSent] = useState(asked)
  if (asked !== seen) {
    setSeen(asked)
    if (asked !== sent) setPicked(asked)
  }
  useEffect(() => {
    const kept = open.slice(0, KEPT_OPEN)
    const same =
      picked === (args.selected ?? null) &&
      kept.join("\n") === (args.open ?? []).join("\n")
    if (same) return
    const timer = setTimeout(() => {
      setSent(picked)
      update({ ...args, open: [...kept], selected: picked })
    }, KEEP)
    return () => clearTimeout(timer)
  }, [open, picked, args, update])

  // A folder of one folder opens with it, as it shows as one row.
  const onListed = useCallback(
    (folder: string, entries: Parameters<typeof onlyFolder>[1]) => {
      const only = onlyFolder(folder, entries, showing)
      if (only) tree.current?.expand([only])
    },
    [showing]
  )
  // How it shows the folder, and so which folders it lists: the tree's
  // open ones, or those the columns or the filmstrip show.
  const view = viewOf(args.view)
  const listing = useMemo(
    () => listedFor(view, picked, open),
    [view, picked, open]
  )
  const folder = useFolder(engine, project, dir, listing, onListed)
  const changeIn = folder.change
  const { paths, ignored } = useMemo(
    () => treeOf(folder.listed, showing),
    [folder.listed, showing]
  )
  // What the tree shows: the paths with what Files made or renamed itself
  // until its folder is listed again, so another folder listed meanwhile
  // takes neither back. All else here waits for the listing.
  const held = useMemo(() => {
    const laid = ahead(folder.listed, folder.expected)
    return laid === folder.listed ? paths : treeOf(laid, showing).paths
  }, [folder.listed, folder.expected, showing, paths])

  // git's marks, where the folder is in the Project's repository.
  const inside = folder.top.state === "listed" && folder.top.inside
  const real = folder.top.state === "listed" ? folder.top.real : null
  const status = useGitStatus(engine, project, inside)
  const marks = useMemo(
    () =>
      status && projectTop && real
        ? marksOf(status, projectTop, real)
        : NO_MARKS,
    [status, projectTop, real]
  )

  // The Agents at work: each one's file pulses in its colour; the turn of
  // the Thread it is with marks what it changed.
  const threads = useThreads(engine, project)
  const harnesses = useHarnesses(engine)
  const touched = useTouched(engine, project)
  const thread = threadOf(threads, args.thread)
  const colour = useCallback(
    (id: string) =>
      colourOf(harnesses, threads.find((one) => one.id === id)?.harness ?? ""),
    [harnesses, threads]
  )
  const here = real ?? dir
  const pulses = useMemo(
    () => pulsesOf(touched, here, projectTop, colour),
    [touched, here, projectTop, colour]
  )
  const mine = thread ? touchOf(touched, thread.id) : undefined
  const turn = thread?.latest?.turn ?? null
  const turnedPaths = useTurned(
    engine,
    project,
    thread?.id ?? null,
    turn,
    projectTop
  )

  // What it touches: Follow goes there, the file it writes or else the
  // one it reads; and what it writes is marked at once, until its end
  // reads git's checkpoints again (ADR 0073, decisions 3 and 9).
  const [target, setTarget] = useState<Target | null>(null)
  const [writes, setWrites] = useState({ turn, paths: [] as string[] })
  const [heard, setHeard] = useState<typeof mine>(undefined)
  if (mine !== heard) {
    setHeard(mine)
    if (mine) setTarget(nextTarget(target, mine, projectTop))
    const wrote = mine?.kind === "write" && wholeFrom(mine.path, projectTop)
    if (wrote)
      setWrites({
        turn,
        paths: writes.turn === turn ? [...writes.paths, wrote] : [wrote],
      })
  }
  const written = writes.turn === turn ? writes.paths : NO_WRITES
  const turned = useMemo(
    () => turnedIn([...turnedPaths, ...written], here),
    [turnedPaths, written, here]
  )

  // The filter: what `files.find` finds under the folder, with its
  // folders.
  const [filter, setFilter] = useState<string | null>(null)
  const [found, setFound] = useState<{ words: string; paths: string[] }>()
  const words = filter?.trim() ?? ""
  useEffect(() => {
    if (!words || !real) return
    let gone = false
    const timer = setTimeout(() => {
      engine
        .call(
          "files.find",
          { dir: real, query: words, limit: MATCHES },
          { project }
        )
        .then(
          (answer) => gone || setFound({ words, paths: answer.paths }),
          () => gone || setFound({ words, paths: [] })
        )
    }, WAIT)
    return () => {
      gone = true
      clearTimeout(timer)
    }
  }, [engine, project, real, words])
  const matches = useMemo(
    () => (found && words ? matchesOf(found.paths) : null),
    [found, words]
  )
  const filtering = matches !== null

  // Expand all opens the folders as they are listed, past those git
  // ignores, until it has opened enough.
  const [expanding, setExpanding] = useState(false)
  const ignoredFolders = useMemo(
    () => ignored.filter((path) => path.endsWith("/")),
    [ignored]
  )
  const expandable = useMemo(
    () =>
      paths.filter(
        (path) =>
          path.endsWith("/") &&
          !ignoredFolders.some((one) => path.startsWith(one))
      ),
    [paths, ignoredFolders]
  )
  const allOpen =
    expandable.length > 0 && expandable.every((path) => open.includes(path))
  useEffect(() => {
    if (!expanding || filtering || open.length >= EXPANDED) return
    tree.current?.expand(expandable.filter((path) => !open.includes(path)))
  }, [expanding, filtering, expandable, open])

  const [editing, setEditing] = useState(false)
  const startFilter = useCallback((typed: string) => {
    setFilter((was) => (was ?? "") + typed)
    requestAnimationFrame(() => filterField.current?.focus())
  }, [])
  const endFilter = useCallback(() => {
    setFilter(null)
    setFound(undefined)
    requestAnimationFrame(() => tree.current?.focus())
  }, [])
  const up = useCallback(() => {
    const above = parentOf(dir)
    if (above) onGo(above, `${nameOf(dir)}/`)
  }, [dir, onGo])
  const openRow = useCallback(
    (path: string) => {
      if (path.endsWith("/")) return onGo(wholeOf(dir, path))
      opened.current = wholeOf(dir, path)
      onOpenFile(opened.current)
    },
    [dir, onGo, onOpenFile]
  )
  const toggleHidden = useCallback(
    () => change({ hidden: !(now.current.hidden ?? showing.hidden) }),
    [change, showing.hidden]
  )
  // Another view of the same pick, which takes the keys.
  const info = infoIn(args)
  const showAs = useCallback(
    (to: View) => {
      if (to !== viewOf(now.current.view)) change({ view: to })
      else tree.current?.focus()
    },
    [change]
  )
  const shownBefore = useRef(view)
  useEffect(() => {
    if (shownBefore.current === view) return
    shownBefore.current = view
    requestAnimationFrame(() => tree.current?.focus())
  }, [view])
  // Quick Look (ADR 0073, decision 7): the row picked, over the desk.
  const peek = useCallback(
    (path: string) =>
      run?.("files.peek", { file: wholeOf(dir, path), project }),
    [run, dir, project]
  )

  // A file held over this Pane from another machine is refused, in words
  // that say where it is (ADR 0106, decision 3): only the machines count,
  // the host alone judging whether two names are one file.
  const refused = useCallback(
    (files: readonly ProjectFile[]) => {
      const why = files
        .map((one) => device?.across(one, project))
        .find((words) => words !== undefined)
      if (why) toast.warning(why, { id: `across ${why}` })
      return why !== undefined
    },
    [device, project]
  )
  // What Files does with its rows (decision 10): each said in a toast with
  // Undo; a name taken where they go is asked about.
  const at = useMemo(() => ({ engine, project }), [engine, project])
  const { ask, dialog: clashes } = useClashes()
  const [searching, setSearching] = useState(false)
  const [renaming, setRenaming] = useState<Named[] | null>(null)
  // What was made just now, said made once it is named in place.
  const made = useRef<{ path: string; done: Undoable } | null>(null)
  /** The rows an act takes: those picked, when `row` is among them, or
   * `row` alone; with none, those picked. */
  const rowsFor = useCallback(
    (row?: string | null): string[] => {
      const all = tree.current?.picked() ?? []
      if (row == null) return all.length > 0 ? all : picked ? [picked] : []
      return all.includes(row) ? all : [row]
    },
    [picked]
  )
  // What a copy or a move made is picked, as a Finder picks it.
  const transfer = useCallback(
    async (
      copy: boolean,
      paths: readonly string[],
      into: string,
      beside = false
    ) => {
      const done = await acts.transfer(at, {
        copy,
        paths,
        dir: wholeOf(dir, into),
        ask,
        beside,
      })
      const first = done?.paths[0]
      const row = first === undefined ? null : within(here, first)
      if (row) setPicked(row)
      return done
    },
    [at, dir, ask, here]
  )
  // A new thing is made untitled, then named in place.
  const newItem = useCallback(
    async (kind: Making, row: string | null) => {
      const into = folderOfRow(row)
      const name = untitled(folder.listed.get(into) ?? [], kind === "folder")
      // Its row shows before the folder is listed again, so the folder
      // expects it until then: else a listing from before it was made, or
      // one of another folder meanwhile, would take the row back, its
      // field with it. A thing not made is not expected.
      const over = changeIn(into)
      let done: Undoable | null = null
      try {
        done = await acts.make(at, wholeOf(dir, into), name, kind)
      } finally {
        over(done ? { made: { name, kind } } : { failed: true })
      }
      if (!done) return
      const path = `${into}${name}${kind === "folder" ? "/" : ""}`
      if (into) tree.current?.expand([into])
      tree.current?.add(path)
      made.current = { path, done }
      setPicked(path)
      requestAnimationFrame(() => tree.current?.rename(path, true))
    },
    [at, dir, folder.listed, changeIn]
  )
  const onRename = useCallback(
    async (from: string, to: string) => {
      const was = made.current?.path === from ? made.current.done : undefined
      made.current = null
      const name = nameOf(wholeOf(dir, to))
      // The tree shows it renamed already, so the folder expects it until
      // it is listed again: else a listing from before the rename, or one
      // of another folder meanwhile, would name it back.
      const over = changeIn(parentRow(from), {
        from: nameOf(wholeOf(dir, from)),
        to: name,
      })
      let done = false
      try {
        done = await acts.rename(at, wholeOf(dir, from), name, was)
      } finally {
        over(done ? undefined : { failed: true })
      }
      if (done) setPicked(to)
      return done
    },
    [at, dir, changeIn]
  )
  const act = useCallback(
    (what: Does, row: string | null = null) => {
      const rows = rowsFor(row)
      const wholes = rows.map((one) => wholeOf(dir, one))
      switch (what) {
        case "rename":
          if (rows.length > 1) setRenaming(wholes.map((path) => ({ path })))
          else if (rows[0]) tree.current?.rename(rows[0])
          return
        case "trash":
          if (rows.length > 0) void acts.trash(at, wholes)
          return
        case "duplicate": {
          // Each beside itself, a folder's at once.
          const byFolder = new Map<string, string[]>()
          for (const one of rows) {
            const into = parentRow(one)
            byFolder.set(into, [...(byFolder.get(into) ?? []), one])
          }
          for (const [into, some] of byFolder)
            void transfer(
              true,
              some.map((one) => wholeOf(dir, one)),
              into,
              true
            )
          return
        }
        case "copy":
        case "cut":
          if (rows.length > 0 && file) keep(wholes.map(file), what === "cut")
          return
        case "paste": {
          const clip = kept()
          if (!clip || refused(clip.files)) return
          void transfer(
            !clip.cut,
            clip.files.map((one) => one.path),
            folderOfRow(row ?? picked)
          ).then((done) => done && !done.stopped && pasted(clip))
          return
        }
        case "new-file":
        case "new-folder":
          void newItem(what === "new-file" ? "file" : "folder", row ?? picked)
          return
        case "undo":
          if (!acts.undoLatest(at)) toast("Nothing to undo here.")
          return
        case "search":
          setSearching(true)
          return
      }
    },
    [
      rowsFor,
      dir,
      at,
      transfer,
      picked,
      newItem,
      setRenaming,
      setSearching,
      file,
      refused,
    ]
  )
  /** What a row's menu offers, or the folder's, under the rows. */
  const offersOf = (row: string | null): Does[] => [
    "new-file",
    "new-folder",
    ...(kept() ? (["paste"] as const) : []),
    ...(row === null
      ? []
      : (["rename", "duplicate", "copy", "cut", "trash"] as const)),
  ]

  const does = useCallback(
    (what: Does) => {
      // The row picked as the tree has it now: a key may be quicker than
      // the tree's word of it.
      const row = tree.current?.picked().at(-1) ?? picked
      switch (what) {
        case "up":
          return up()
        case "path":
          return setEditing(true)
        case "hidden":
          return toggleHidden()
        case "filter":
          return startFilter("")
        case "peek": {
          const close = peeked()
          if (close) close()
          else if (row) peek(row)
          return
        }
        case "open":
          if (row) openRow(row)
          return
        case "list":
        case "columns":
        case "gallery":
          return showAs(what)
        case "info":
          return change({ info: !infoIn(now.current) })
        default:
          act(what)
      }
    },
    [up, toggleHidden, startFilter, picked, openRow, peek, act, showAs, change]
  )
  // As the pick moves, Quick Look shows it, from the tree that has the
  // keys.
  const peekedAt = useRef(picked)
  useEffect(() => {
    if (peekedAt.current === picked) return
    peekedAt.current = picked
    if (focused && picked && peeked()) peek(picked)
  }, [picked, focused, peek])
  // Its keys, the actions of its scope: each where the Pane takes it, as
  // the focus is in its view or its fields (`takes`), and no further, so
  // the tree's own reading of F2 or ↵ never hears a key taken.
  const handlers = useMemo(
    () =>
      Object.fromEntries(
        KEYS.map(({ does: what, id }): [string, Handler] => [
          id,
          (_, event) => {
            const from = event?.composedPath()[0]
            const field =
              from instanceof Element && from.closest(FIELDS) !== null
            const inView =
              !event ||
              (event.target instanceof Node &&
                (area.current?.contains(event.target) ?? false))
            if (!takes(what, { field, view: inView })) return false
            event?.stopPropagation()
            does(what)
            return true
          },
        ])
      ),
    [does]
  )
  const scope = useScope(FILES, handlers, { tile: true })

  // Follow: the pick and the file opened go where the turn goes, once the
  // Person is still. Where it went last; it moves only while the turn
  // runs.
  const follow = args.follow === true
  const [went, setWent] = useState<Target | null>(null)
  const moving = follow && mine !== undefined && target !== null
  const [waiting, setWaiting] = useState(false)
  const goTo = useCallback(
    (to: Target) => {
      setWent(to)
      setWaiting(false)
      const path = within(here, to.path)
      if (path) setPicked(path)
      opened.current =
        moveFile(project, opened.current, to.path, to.line) ?? opened.current
    },
    [here, project]
  )
  const [looked, setLooked] = useState(0)
  useEffect(() => {
    if (!moving || !target || target === went) return
    const now = Date.now()
    const at = followsAt(now, workedAt(project), holding(project))
    if (at === now) {
      const timer = setTimeout(() => goTo(target))
      return () => clearTimeout(timer)
    }
    // It says it waits, and looks again once the Person may be done.
    const timers = [
      setTimeout(() => setWaiting(true)),
      setTimeout(
        () => setLooked((n) => n + 1),
        at === null ? LOOK_AGAIN : at - now
      ),
    ]
    return () => timers.forEach(clearTimeout)
  }, [moving, target, went, project, goTo, looked])
  const toggleFollow = () => update({ ...args, follow: !follow })

  // The row whose menu is open, none for the space under the rows, and
  // how many rows it acts on. What it chose runs once it has closed and
  // given the keys back, so a rename it starts keeps them.
  const [menu, setMenu] = useState<{ row: string | null; count: number }>()
  const chosen = useRef<(() => void) | null>(null)
  const later = (what: Does, row: string | null) => {
    chosen.current = () => act(what, row)
  }
  const [noLimit, setNoLimit] = useState(false)

  // Rows dragged: into a Thread's composer as `@` chips, and out to other
  // apps as the files.
  const drag = useCallback(
    (paths: string[], event: DragEvent) => {
      const wholes = paths.map(named)
      if (!file) return
      const locals = wholes.map(local)
      dragFiles(
        event,
        wholes.map(file),
        locals.every((one) => one !== undefined)
          ? (locals as DeviceFile[])
          : undefined
      )
    },
    [named, file, local]
  )
  // Dropped here: refused from another machine, moved or copied else.
  const drop = useCallback(
    (dropped: readonly ProjectFile[], into: string, copy: boolean) => {
      if (refused(dropped)) return
      void transfer(
        copy,
        dropped.map((one) => one.path),
        into
      )
    },
    [refused, transfer]
  )

  // The tree takes the keys once it is drawn, in the Pane that has the
  // focus: as it opens, and after it went to another folder.
  const listed = folder.top.state === "listed"
  const tookKeys = useRef(false)
  useEffect(() => {
    if (!listed || !focused || tookKeys.current) return
    tookKeys.current = true
    requestAnimationFrame(() => tree.current?.focus())
  }, [listed, focused])

  // A letter typed in the view starts the filter with it; a rename's
  // field in the tree is a field too: its press comes from inside it.
  const onKeyDownCapture = (event: React.KeyboardEvent) => {
    const from = event.nativeEvent.composedPath()[0]
    const inField = from instanceof Element && from.closest(FIELDS) !== null
    const inView = area.current?.contains(event.target as Node) ?? false
    if (inField || !inView || !typesFilter(event)) return
    startFilter(event.key)
    event.preventDefault()
    event.stopPropagation()
  }

  // What the Columns and the Gallery are told, and tell, as the tree.
  const rowMarks: RowMarks = useMemo(
    () => ({
      marks,
      holds: holdingFolders(marks.keys()),
      turned,
      turnHolds: holdingFolders(turned),
      pulses,
    }),
    [marks, turned, pulses]
  )
  const events: ViewEvents = {
    onSelect: setPicked,
    onOpen: openRow,
    onDrag: drag,
    onDrop: drop,
    onRename,
  }
  // The info of the row picked, or of the folder with none; its picture
  // left out under a preview that shows it.
  const infoOf = (row: string | null, className?: string, picture = true) => (
    <InfoPane
      engine={engine}
      project={project}
      path={row ? wholeOf(dir, row) : dir}
      modified={row ? entryOf(folder.listed, row)?.modified : undefined}
      picture={picture}
      className={className}
    />
  )
  // The file picked, drawn small, or its info where nothing draws it.
  const look = (row: string, below?: React.ReactNode) => (
    <Look
      engine={engine}
      project={project}
      path={wholeOf(dir, row)}
      run={run}
      local={local}
      instead={infoOf(row, "flex-1")}
      after={below}
    />
  )
  // The tree's rows show their small pictures, when files.toml asks.
  const pictured = useMemo(
    () =>
      new Map(
        thumbnails && view === "list"
          ? paths
              .filter(isPicture)
              .slice(0, PICTURED)
              .map((row) => {
                const entry = entryOf(folder.listed, row)
                const whole = wholeOf(dir, row)
                return [
                  row,
                  { path: whole, modified: entry?.modified, size: entry?.size },
                ]
              })
          : []
      ),
    [thumbnails, view, paths, folder.listed, dir]
  )
  const pictures = useThumbs(engine, project, pictured, 16)

  const body = (() => {
    if (searching && real)
      return (
        <SearchView
          engine={engine}
          project={project}
          dir={real}
          onOpen={(path, line) =>
            run?.("files.open", { file: wholeOf(real, path), line, project })
          }
          onClose={() => {
            setSearching(false)
            requestAnimationFrame(() => tree.current?.focus())
          }}
        />
      )
    if (folder.top.state === "loading") return <Loading />
    if (folder.top.state === "refused")
      return (
        <Card
          icon={<FolderXIcon />}
          title={
            folder.top.gone
              ? "This folder is not there"
              : "This folder cannot be read"
          }
          note={folder.top.message}
        >
          <div className="flex gap-2">
            {parentOf(dir) && (
              <Button size="sm" variant="outline" onClick={up}>
                The folder above
              </Button>
            )}
            {home && (
              <Button size="sm" variant="outline" onClick={() => onGo(home)}>
                Home
              </Button>
            )}
          </div>
        </Card>
      )
    if (filtering && matches.paths.length === 0)
      return <Quiet>Nothing here fits “{words}”.</Quiet>
    // The filter's matches are a tree in every view.
    const shownAs = filtering ? "list" : view
    const empty = shownAs === "list" && !filtering && paths.length === 0
    return (
      <ContextMenu
        onOpenChangeComplete={(isOpen) => {
          if (isOpen) return
          setMenu(undefined)
          const run = chosen.current
          chosen.current = null
          if (run) requestAnimationFrame(run)
        }}
      >
        <ContextMenuTrigger
          render={
            <div
              ref={area}
              tabIndex={empty ? 0 : undefined}
              aria-label={empty ? "This folder is empty" : undefined}
              className={cn(
                "h-full min-h-0 outline-none",
                shownAs === "list" && "px-1 pt-1"
              )}
            />
          }
          onContextMenu={(event) => {
            // The view has picked the row first.
            const row = rowAt(event.nativeEvent)
            setMenu({ row, count: row === null ? 0 : rowsFor(row).length })
          }}
        >
          {empty && <Quiet>This folder is empty.</Quiet>}
          {shownAs === "columns" ? (
            <Columns
              ref={tree}
              label={`Files of ${nameOf(dir)}`}
              top={nameOf(dir)}
              listed={folder.listed}
              showing={showing}
              loading={folder.listing}
              picked={picked}
              marks={rowMarks}
              aside={
                picked &&
                look(
                  picked,
                  info
                    ? infoOf(picked, "max-h-[55%] shrink-0 border-t", false)
                    : null
                )
              }
              {...events}
            />
          ) : shownAs === "gallery" ? (
            <Gallery
              ref={tree}
              label={`Files of ${nameOf(dir)}`}
              engine={engine}
              project={project}
              dir={dir}
              listed={folder.listed}
              showing={showing}
              picked={picked}
              marks={rowMarks}
              big={picked ? look(picked) : <Quiet>This folder is empty.</Quiet>}
              {...events}
            />
          ) : (
            <FolderTree
              ref={tree}
              label={`Files of ${nameOf(dir)}`}
              version={
                filtering
                  ? `find\0${found?.words}`
                  : `${showing.hidden}\0${showing.ignored}`
              }
              paths={filtering ? matches.paths : held}
              open={filtering ? matches.open : open}
              marks={marks}
              turned={turned}
              pulses={pulses}
              ignored={filtering ? [] : ignored}
              loading={folder.listing}
              selected={picked}
              onSelect={setPicked}
              onOpenChange={(now) => {
                if (filtering) return
                if (now.length < open.length) setExpanding(false)
                setOpen(now)
              }}
              pictures={pictures}
              onOpen={openRow}
              onDrag={drag}
              onRename={onRename}
              onDrop={drop}
            />
          )}
        </ContextMenuTrigger>
        <ContextMenuContent
          aria-label={menu?.row === null ? "Folder" : "Row"}
          className="min-w-52"
        >
          {menu?.row === null && (
            <MakeItems
              acts={{
                offers: offersOf(null),
                run: (what) => later(what, null),
                count: 0,
              }}
            />
          )}
          {menu?.row != null && (
            <RowMenu
              whole={wholeOf(dir, menu.row)}
              local={local(wholeOf(dir, menu.row))}
              folder={menu.row.endsWith("/")}
              top={projectTop}
              pinned={pinned.includes(wholeOf(dir, menu.row))}
              onOpen={() => openRow(menu.row ?? "")}
              onPeek={() => peek(menu.row ?? "")}
              onShow={
                local(wholeOf(dir, menu.row)) === undefined
                  ? () => {
                      const whole = wholeOf(dir, menu.row ?? "")
                      onGo(parentOf(whole) ?? "/", nameOf(whole))
                    }
                  : undefined
              }
              onSaveCopy={
                local(wholeOf(dir, menu.row)) === undefined &&
                !menu.row.endsWith("/") &&
                device?.has("save_file")
                  ? () =>
                      run?.("file.save-copy", {
                        file: wholeOf(dir, menu.row ?? ""),
                        project,
                      })
                  : undefined
              }
              onAttach={() => onAttach(rowsFor(menu.row).map(named))}
              onPin={onPin && ((on) => onPin(wholeOf(dir, menu.row ?? ""), on))}
              acts={{
                offers: offersOf(menu.row),
                run: (what) => later(what, menu.row),
                count: menu.count,
              }}
            />
          )}
        </ContextMenuContent>
      </ContextMenu>
    )
  })()

  return (
    <div
      ref={scope}
      data-files={project}
      className="flex min-h-0 flex-1 flex-col"
      onKeyDownCapture={onKeyDownCapture}
    >
      <InHeader>
        <ViewSwitch view={view} onShow={showAs} />
        <HeaderButton
          label="Info"
          title={keyLabel(idOf("info"), "Info")}
          on={info}
          onClick={() => does("info")}
        >
          <InfoIcon />
        </HeaderButton>
        <HeaderButton
          label="Follow the Agent"
          title={
            follow
              ? "Following the Agent: its file is picked and opened"
              : "Follow the Agent"
          }
          on={follow}
          onClick={toggleFollow}
        >
          <LocateFixedIcon />
        </HeaderButton>
        <HeaderButton
          label="Hidden files"
          title={keyLabel(idOf("hidden"), "Hidden files")}
          on={showing.hidden}
          onClick={toggleHidden}
        >
          {showing.hidden ? <EyeIcon /> : <EyeOffIcon />}
        </HeaderButton>
        {view === "list" && (
          <HeaderButton
            label={allOpen ? "Collapse all" : "Expand all"}
            onClick={() => {
              if (allOpen) {
                setExpanding(false)
                tree.current?.collapse()
              } else setExpanding(true)
            }}
          >
            {allOpen ? <ChevronsDownUpIcon /> : <ChevronsUpDownIcon />}
          </HeaderButton>
        )}
      </InHeader>
      <PathBar
        engine={engine}
        project={project}
        dir={dir}
        home={home}
        editing={editing}
        onEdit={(now) => {
          setEditing(now)
          if (!now) requestAnimationFrame(() => tree.current?.focus())
        }}
        onGo={onGoTyped}
        onFilter={() => startFilter("")}
      />
      {filter !== null && (
        <div className="flex h-8 shrink-0 items-center gap-1.5 border-b pr-1 pl-2.5">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={filterField}
            aria-label="Filter"
            placeholder="Filter"
            spellCheck={false}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                event.stopPropagation()
                endFilter()
              } else if (event.key === "ArrowDown" || event.key === "Enter") {
                event.preventDefault()
                tree.current?.focus()
              }
            }}
            className="h-6 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          {found && found.paths.length >= MATCHES && (
            <span className="shrink-0 text-meta text-muted-foreground">
              first {MATCHES}
            </span>
          )}
          <HeaderButton label="Clear the filter" onClick={endFilter}>
            <XIcon />
          </HeaderButton>
        </div>
      )}
      {/* A key or a click on the tree keeps Follow waiting; the header's
          buttons do not. */}
      <div className="flex min-h-0 flex-1">
        <div
          className="min-h-0 min-w-0 flex-1"
          onKeyDownCapture={() => workedIn(project)}
          onPointerDownCapture={() => workedIn(project)}
          onKeyDown={(event) => {
            // Escape in the tree clears the filter, as in its field.
            if (event.key === "Escape" && filter !== null) {
              event.stopPropagation()
              endFilter()
            }
          }}
        >
          {body}
        </div>
        {/* Columns show the info in their last column. */}
        {info &&
          (view !== "columns" || filtering) &&
          !searching &&
          infoOf(picked, "w-64 max-w-[45%] shrink-0 border-l")}
      </div>
      {follow && (
        <div
          role="status"
          aria-label="Follow"
          className="flex h-6 shrink-0 items-center gap-1.5 border-t px-2.5 text-meta text-muted-foreground"
        >
          <span
            className="flex items-center gap-1.5"
            style={thread ? { color: colour(thread.id) } : undefined}
          >
            <LocateFixedIcon className="size-3" />
            Following the Agent
          </span>
          {moving && waiting && <span>· waits while you work here</span>}
        </div>
      )}
      {clashes}
      <BulkRename
        at={at}
        rows={renaming}
        taken={(whole) => {
          const inside = within(dir, whole)
          const listed =
            inside === null ? [] : folder.listed.get(inside ? `${inside}/` : "")
          return new Set((listed ?? []).map((entry) => entry.name))
        }}
        onClose={() => setRenaming(null)}
      />
      {folder.limit && !noLimit && (
        <div
          role="status"
          className="flex shrink-0 items-start gap-1 border-t px-2.5 py-1.5 text-meta text-muted-foreground"
        >
          <p className="min-w-0 flex-1">
            The system watches no more folders, so some changes here go unseen.
            Raise <code className="font-mono">fs.inotify.max_user_watches</code>{" "}
            to see them.
          </p>
          <HeaderButton label="Close" onClick={() => setNoLimit(true)}>
            <XIcon />
          </HeaderButton>
        </div>
      )}
    </div>
  )
}

/** The folder a row is, or is in: `""` the top. */
const folderOfRow = (row: string | null) =>
  !row ? "" : row.endsWith("/") ? row : parentRow(row)

/** git's changes in the Project, from the git module's `git.watch`, while
 * the folder is in the Project's folder; none outside it or with no
 * repository. */
function useGitStatus(
  engine: Engine,
  project: ProjectId,
  inside: boolean
): { path: string; status: string }[] | null {
  const [files, setFiles] = useState<{ path: string; status: string }[] | null>(
    null
  )
  useEffect(() => {
    if (!inside) return
    const stop = engine.stream(
      project,
      "git.watch",
      {},
      (status) => setFiles(status.repo ? status.files : null),
      () => {}
    )
    return () => {
      stop()
      setFiles(null)
    }
  }, [engine, project, inside])
  return inside ? files : null
}

/** The views' icons and names, in their keys' order. */
const SHOWN: Record<View, { icon: ReactNode; name: string }> = {
  list: { icon: <ListTreeIcon />, name: "List" },
  columns: { icon: <Columns3Icon />, name: "Columns" },
  gallery: { icon: <GalleryThumbnailsIcon />, name: "Gallery" },
}

/** The header's quiet switch between the views, each with its key. */
function ViewSwitch({
  view,
  onShow,
}: {
  view: View
  onShow: (view: View) => void
}) {
  const keyLabel = useKeyLabel()
  return (
    <div
      role="radiogroup"
      aria-label="View"
      className="flex shrink-0 items-center gap-px rounded-control p-px"
    >
      {VIEWS.map((one) => (
        <Button
          key={one}
          variant="ghost"
          size="icon-xs"
          role="radio"
          aria-checked={one === view}
          aria-label={SHOWN[one].name}
          title={keyLabel(idOf(one), SHOWN[one].name)}
          className={cn(
            "size-5.5 shrink-0",
            one === view
              ? "bg-foreground/8 text-foreground hover:bg-foreground/10"
              : "text-muted-foreground"
          )}
          onClick={() => onShow(one)}
        >
          {SHOWN[one].icon}
        </Button>
      ))}
    </div>
  )
}

function Loading() {
  return (
    <div className="flex h-full flex-1 items-center justify-center">
      <Spinner className="text-muted-foreground" />
    </div>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-xs text-muted-foreground">{children}</p>
}
