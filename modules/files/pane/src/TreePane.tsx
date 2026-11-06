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
 * their menu or a drag, and out to other apps as the files (step F2). It
 * only reads: the file operations come later (step F5).
 *
 * The Agents' work shows on it (decisions 3 and 9): the row of the file
 * each running turn works on pulses in its Agent's colour, and a quiet
 * dot sits on what the turn of its Thread changed. Follow, off at first,
 * moves the pick and the file it opened to the file that Agent works on.
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
import { FILES_FILE } from "@banda/contract/files"
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
import { Spinner } from "@banda/ui/components/spinner"
import { useHarnesses } from "@banda/ui/hooks/use-harnesses"
import { useProjects } from "@banda/ui/hooks/use-projects"
import { useRead } from "@banda/ui/hooks/use-read"
import { useWiderThan } from "@banda/ui/hooks/use-wider-than"
import { dragFiles } from "@banda/ui/lib/file-drag"
import { FIELDS, keyLabel } from "@banda/ui/lib/keys"
import { useFile } from "@banda/ui/lib/look"
import { shownProjects } from "@banda/ui/lib/projects"
import type { WindowApi } from "@banda/ui/module"
import { definePane, type PaneProps, paneOf } from "@banda/ui/pane"
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  EyeIcon,
  EyeOffIcon,
  FolderTreeIcon,
  FolderXIcon,
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
  turnedIn,
  wholeFrom,
} from "./agent"
import { Card } from "./Facts"
import { useFolder } from "./folder"
import { HeaderButton } from "./HeaderButton"
import { keyOf, treeKey, typesFilter, type Does } from "./keys"
import { marksOf } from "./marks"
import { PathBar } from "./PathBar"
import { Rail } from "./Rail"
import { RecentList } from "./RecentList"
import { useThreads, useTouched, useTurned } from "./live"
import { RowMenu } from "./RowMenu"
import { matchesOf, onlyFolder, type Showing, treeOf } from "./tree"
import { nameOf, parentOf, tilded, untilded, wholeOf, within } from "./where"
import { holding, moveFile, workedAt, workedIn } from "./work"
import { peeked } from "./peek"

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
  /** Its pick and the file it opened follow the Agent's file. */
  follow?: boolean
  /** The Thread it was opened from: whose turns it marks and follows. */
  thread?: string
}

export const treePane = definePane<TreeArgs>({
  kind: "files.tree",
  title: (args) => (args.recent ? "Recent" : nameOf(args.dir) || "Files"),
  detail: (args) => (args.recent ? null : args.dir || null),
  icon: FolderTreeIcon,
  // The launcher's Files: the Project's folder.
  start: { dir: "" },
  letter: "F",
  narrow: true,
  // One to go back to in a Project: the Banda menu's Files and "Show in
  // Files" find it again.
  identity: () => "files",
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

const asks = new Set<(does: Does) => void>()

/** Has the focused Files Pane do `does`, as its key would: how an action,
 * which `keys.toml` binds, reaches it. Whether one heard. */
export function askTree(does: Does): boolean {
  for (const hear of asks) hear(does)
  return asks.size > 0
}

function TreePane(props: PaneProps<TreeArgs>) {
  const { engine, project, args, update, label } = props
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
  const recent = args.recent === true
  const dir = args.dir

  // Its header names the folder with ~ for home.
  useEffect(() => {
    if (recent || !dir) label?.(null)
    else label?.({ title: nameOf(dir), detail: tilded(dir, home) })
  }, [label, recent, dir, home])

  // Another folder, its folders folded; out of Recent.
  const go = useCallback(
    (to: string, selected: string | null = null) =>
      update({ ...args, dir: to, open: [], selected, recent: false }),
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
      for (const file of wholes) props.run?.("file.attach", { file })
    },
    [props]
  )
  const pin = useCallback(
    (whole: string, on: boolean) =>
      props.run?.("files.pin", { dir: tilded(whole, home), pin: on }),
    [props, home]
  )
  const pinned = useMemo(
    () => finder.pinned.map((place) => untilded(place, home, "/")),
    [finder.pinned, home]
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
        at={recent ? null : dir}
        recent={recent}
        onGo={(to) => go(to)}
        onRecent={() => update({ ...args, recent: true })}
        onUnpin={(place) => pin(place, false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {recent ? (
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
            showing={{ hidden, ignored: finder.ignored }}
            pinned={pinned}
            onGo={go}
            onGoTyped={goTyped}
            onOpenFile={openFile}
            onAttach={attach}
            onPin={pin}
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
  pinned: readonly string[]
  onGo: (dir: string, selected?: string | null) => void
  onGoTyped: (path: string) => Promise<string | null>
  onOpenFile: (whole: string) => void
  onAttach: (wholes: readonly string[]) => void
  onPin: (whole: string, on: boolean) => void
}

/** One folder: its path, its tree, and what the filter found in it. */
function FolderView({
  engine,
  project,
  args,
  update,
  focused,
  run,
  home,
  projectTop,
  showing,
  pinned,
  onGo,
  onGoTyped,
  onOpenFile,
  onAttach,
  onPin,
}: FolderViewProps) {
  const dir = args.dir
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
  const folder = useFolder(engine, project, dir, open, onListed)
  const { paths, ignored } = useMemo(
    () => treeOf(folder.listed, showing),
    [folder.listed, showing]
  )

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
  const mine = thread
    ? touched.find((one) => one.thread === thread.id)
    : undefined
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
    () => update({ ...args, hidden: !showing.hidden }),
    [args, update, showing.hidden]
  )
  // Quick Look (ADR 0073, decision 7): the row picked, over the desk.
  const peek = useCallback(
    (path: string) =>
      run?.("files.peek", { file: wholeOf(dir, path), project }),
    [run, dir, project]
  )
  const does = useCallback(
    (what: Does) => {
      // The row picked as the tree has it now: a key may be quicker than
      // the tree's word of it.
      const row = tree.current?.picked().at(-1) ?? picked
      if (what === "up") up()
      else if (what === "path") setEditing(true)
      else if (what === "hidden") toggleHidden()
      else if (what === "filter") startFilter("")
      else if (what === "peek") {
        const close = peeked()
        if (close) close()
        else if (row) peek(row)
      } else if (row) openRow(row)
    },
    [up, toggleHidden, startFilter, picked, openRow, peek]
  )
  // As the pick moves, Quick Look shows it, from the tree that has the
  // keys.
  const peekedAt = useRef(picked)
  useEffect(() => {
    if (peekedAt.current === picked) return
    peekedAt.current = picked
    if (focused && picked && peeked()) peek(picked)
  }, [picked, focused, peek])
  // The actions reach the focused Pane.
  useEffect(() => {
    if (!focused) return
    asks.add(does)
    return () => {
      asks.delete(does)
    }
  }, [focused, does])

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

  const [menu, setMenu] = useState<string | null>(null)
  const [noLimit, setNoLimit] = useState(false)

  // Rows dragged: into a Thread's composer as `@` chips, and out to other
  // apps as the files.
  const drag = useCallback(
    (paths: string[], event: DragEvent) => dragFiles(event, paths.map(named)),
    [named]
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

  // Ctrl+L anywhere in the Pane; the rest outside its fields, and ↵, `/`
  // and a letter in the tree.
  const onKeyDownCapture = (event: React.KeyboardEvent) => {
    const what = treeKey(event)
    const target = event.target as Element
    const inField = target.closest(FIELDS) !== null
    const inTree = area.current?.contains(target) ?? false
    const mine =
      what === "path" ||
      (!inField && (what === "up" || what === "hidden")) ||
      (!inField && inTree && what !== undefined)
    if (mine) does(what)
    else if (!inField && inTree && typesFilter(event)) startFilter(event.key)
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  const body = (() => {
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
    if (!filtering && paths.length === 0)
      return <Quiet>This folder is empty.</Quiet>
    return (
      <ContextMenu
        onOpenChangeComplete={(isOpen) => {
          if (!isOpen) setMenu(null)
        }}
      >
        <ContextMenuTrigger
          render={<div ref={area} className="h-full min-h-0 px-1 pt-1" />}
          onContextMenu={(event) => {
            const path = rowAt(event.nativeEvent)
            if (path) setMenu(path)
            else event.preventBaseUIHandler()
          }}
        >
          <FolderTree
            ref={tree}
            label={`Files of ${nameOf(dir)}`}
            version={
              filtering
                ? `find\0${found?.words}`
                : `${showing.hidden}\0${showing.ignored}`
            }
            paths={filtering ? matches.paths : paths}
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
            onOpen={openRow}
            onDrag={drag}
          />
        </ContextMenuTrigger>
        <ContextMenuContent aria-label="Row" className="min-w-52">
          {menu && (
            <RowMenu
              whole={wholeOf(dir, menu)}
              folder={menu.endsWith("/")}
              top={projectTop}
              pinned={pinned.includes(wholeOf(dir, menu))}
              onOpen={() => openRow(menu)}
              onPeek={() => peek(menu)}
              onAttach={() => {
                // The rows picked with it, as a Finder acts on them all.
                const picked = tree.current?.picked() ?? []
                onAttach((picked.includes(menu) ? picked : [menu]).map(named))
              }}
              onPin={(on) => onPin(wholeOf(dir, menu), on)}
            />
          )}
        </ContextMenuContent>
      </ContextMenu>
    )
  })()

  return (
    <div
      data-files={project}
      className="flex min-h-0 flex-1 flex-col"
      onKeyDownCapture={onKeyDownCapture}
    >
      <InHeader>
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
          title={`Hidden files · ${keyLabel(keyOf("hidden"))}`}
          on={showing.hidden}
          onClick={toggleHidden}
        >
          {showing.hidden ? <EyeIcon /> : <EyeOffIcon />}
        </HeaderButton>
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
            <span className="shrink-0 text-[10.5px] text-muted-foreground">
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
      <div
        className="min-h-0 flex-1"
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
      {follow && (
        <div
          role="status"
          aria-label="Follow"
          className="flex h-6 shrink-0 items-center gap-1.5 border-t px-2.5 text-[10.5px] text-muted-foreground"
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
      {folder.limit && !noLimit && (
        <div
          role="status"
          className="flex shrink-0 items-start gap-1 border-t px-2.5 py-1.5 text-[11px] text-muted-foreground"
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
