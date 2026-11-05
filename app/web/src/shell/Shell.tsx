import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  type Engine,
  newId,
  type ProjectId,
  type ProjectSummary,
  type Status,
} from "@banda/contract"
import { waits, works } from "@banda/ui/components/banda-mark"
import { Toaster } from "@banda/ui/components/sonner"
import { inFront, useInFront } from "@banda/ui/hooks/use-in-front"
import { useMachine } from "@banda/ui/hooks/use-status"
import { openProjects, updateProject } from "@banda/ui/lib/projects"
import {
  callsOf,
  IN_PROGRAM,
  type Lists,
  type PaneState,
  QUIET,
} from "@banda/ui/pane"
import { DEFAULT_KEYS } from "@banda/contract/look"
import type { Action, Args, Thing, WindowApi } from "@banda/ui/module"
import { actionFor, keysInForce, rebind } from "../actions/actions"
import { Bar } from "../bar/Bar"
import { mapOf } from "../bar/Map"
import { tomlOf } from "@banda/contract/settings"
import { useWidgets } from "../bar/Widgets"
import type { Layout } from "../bar/arrange"
import { PARTS } from "../bar/placed"
import { Watches } from "../bar/Watches"
import { besideOf, first, isShowing, sightOf } from "../calls/sight"
import { WELL, wentWell } from "../safe/starts"
import { useProblemNews } from "../problems/news"
import { lookingInto } from "../problems/look"
import { BandaMenu } from "../menu/BandaMenu"
import {
  type At,
  type Branch,
  type Choice,
  type Own,
  locateRoute,
  type Opening,
  openingAt,
  openingOf,
  settingsLinkOf,
} from "../menu/menu"
import {
  columnsOf,
  useLookColumns,
  useLookDrawer,
  useLookKeys,
  useLookNotify,
  useLookSound,
} from "../look"
import { modules as known } from "../modules"
import {
  closedOf,
  homeOf,
  identityOf,
  minOf,
  runs,
  showsOf,
  startable,
  widthOf,
} from "../registry"
import { Edge } from "../sidebar/Edge"
import { Sidebar } from "../sidebar/Sidebar"
import { pickPreset } from "../sidebar/settings"
import {
  archive as keepArchived,
  toggled,
  useIsArchived,
} from "../sidebar/archived"
import { useNarrow } from "./narrow"
import type { Arranged } from "@banda/contract/workspaces"
import {
  type Asked,
  NO_VIEW,
  resolve,
  send,
  tidied,
  type View,
  viewOf,
  withAsked,
} from "../workspaces/arrange"
import { floorOf, type Reveal } from "../workspaces/layout"
import { useArranged } from "../workspaces/useArranged"
import {
  current,
  displayOf,
  type Entry,
  entries,
  find,
  focused,
  across,
  focusEntry,
  go,
  heightsOf,
  inBar,
  left,
  samePane,
  share,
  step,
  widthIn,
  type Workspaces as State,
} from "../workspaces/model"
import { Drawer } from "../workspaces/Drawer"
import { Overview } from "../workspaces/Overview"
import type { Frame } from "../workspaces/PaneFrame"
import {
  keepDrawer,
  keepLooked,
  keepSidebar,
  keepSidebarWidth,
  keepView,
  loadDrawer,
  loadLooked,
  loadSidebar,
  loadSidebarWidth,
  loadView,
  moveOver,
} from "../workspaces/store"
import { Workspaces } from "../workspaces/Workspaces"
import {
  ACTIONS,
  answering,
  bringing,
  closing,
  closingShown,
  opening,
  runAction,
  settingsAt,
  type Shell as Parts,
  type Step,
} from "./actions"
import { KeysInForce } from "@banda/ui/hooks/use-key-of"

type Change = (workspaces: State) => Step

/** What the window draws while the engine's arrangement is read. */
const WAITING: State = { list: [{ id: "", columns: [], focus: 0 }], current: 0 }

/** The engine's arrangement, the view and the workspaces they draw. */
type Seen = {
  kept: Arranged["workspaces"] | null
  /** Where in the machine's log `kept` stands. */
  at: number
  view: View
  /** Args Panes asked for, drawn over `kept` until it shows them. */
  asked: Asked
  state: State
}

const NOTHING_SEEN: Seen = {
  kept: null,
  at: 0,
  view: NO_VIEW,
  asked: {},
  state: WAITING,
}

/** How long a change waits for its event before the next goes anyway. */
const DRAWN_WITHIN = 2000

/** The workspaces `view` draws of what `seen` keeps; the view then keeps
 * where each ID it holds stands now. */
function looking(seen: Seen, view: View): Seen {
  if (!seen.kept) return { ...seen, view }
  const { kept, asked } = withAsked(seen.kept, seen.asked, seen.at)
  const state = resolve(kept, view, seen.state, seen.at)
  return { ...seen, asked, state, view: viewOf(state, view.want, seen.at) }
}

/** A change the engine refused is logged: the window draws what it says. */
function refused(error: unknown): void {
  console.warn("The workspaces did not change:", error)
}

/**
 * The window (ADR 0005): the bar on top, the sidebar docked on the left,
 * and the workspaces, or the overview of them all. It holds what they
 * share, the workspaces, which parts show and what the modules call the
 * Person for, tells them of each call where they will notice it, and runs
 * the actions that change them.
 */
/**
 * Ctrl added to a key the window takes hands that key to a program
 * (ADR 0005, decision 10): Ctrl+Alt+W reaches a shell as Alt+W. The
 * program reads the press without Ctrl, as if Banda took nothing, so it
 * comes in whatever form the program asked its terminal for.
 */
function handOn(
  event: KeyboardEvent,
  target: Element | null,
  actions: readonly Action<Parts>[]
): void {
  if (!event.ctrlKey || !event.altKey || event.metaKey) return
  if (!target?.closest(IN_PROGRAM)) return
  const plain = {
    key: event.key,
    code: event.code,
    altKey: true,
    shiftKey: event.shiftKey,
    ctrlKey: false,
    metaKey: false,
  }
  if (!actionFor(actions, plain)) return
  event.preventDefault()
  event.stopPropagation()
  const handed = new KeyboardEvent("keydown", {
    ...plain,
    bubbles: true,
    cancelable: true,
  })
  HANDED.add(handed)
  target.dispatchEvent(handed)
}

/** The presses the window made to hand a key on, which it leaves alone. */
const HANDED = new WeakSet<Event>()

export function Shell({
  engine,
  status,
  modules,
  projects,
  home,
  onCreated,
}: {
  engine: Engine
  status: Status
  modules: readonly string[]
  projects: ProjectSummary[]
  /** The Project a new Thread starts in. */
  home: ProjectId
  onCreated: (project: ProjectSummary) => void
}) {
  // A Project whose folder is missing lists nothing and starts nothing
  // until the Person locates it (ADR 0026, decision 6).
  const open = useMemo(() => openProjects(projects), [projects])
  const openNow = useRef(open)
  useEffect(() => {
    openNow.current = open
  }, [open])
  // The arrangement is the engine's; the view, the window's (ADR 0025).
  const machine = useMachine(engine)
  const live = useArranged(engine)
  const ready = live.state === "ready"
  // A start that drew its workspaces and stayed up went well (ADR 0039).
  useEffect(() => {
    if (!ready) return
    const well = setTimeout(wentWell, WELL)
    return () => clearTimeout(well)
  }, [ready])
  const [drawing, setDrawing] = useState(() =>
    looking(NOTHING_SEEN, loadView())
  )
  // A new arrangement is drawn as the view looks at it, at once.
  if (ready && live.view.workspaces !== drawing.kept) {
    const { workspaces: kept, at } = live.view
    setDrawing(looking({ ...drawing, kept, at }, drawing.view))
  }
  const workspaces = drawing.state
  const setView = useCallback(
    (how: (view: View) => View) =>
      setDrawing((was) => looking(was, how(was.view))),
    []
  )
  useEffect(() => keepView(drawing.view), [drawing.view])
  // The window's arrangement moves to the engine once (decision 2).
  useEffect(() => {
    if (!machine || modules.length === 0) return
    const first = startable(modules)[0]
    moveOver(engine, home, first && { pane: first, width: widthOf(first) })
      .then((kept) => kept && setView(() => kept))
      .catch(refused)
  }, [engine, machine, modules, home, setView])
  // An empty workspace the Person left goes, as niri's.
  const tidying = useRef("")
  useEffect(() => {
    const command = ready ? tidied(workspaces) : undefined
    const key = command ? JSON.stringify([command, workspaces.list.length]) : ""
    if (key === tidying.current) return
    tidying.current = key
    if (command) send(engine, command).catch(refused)
  }, [engine, workspaces, ready])
  const [sidebar, setSidebar] = useState(loadSidebar)
  // How wide the Person dragged it, which the page's every part that
  // starts past it reads.
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth)
  useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-width",
      `${sidebarWidth}rem`
    )
  }, [sidebarWidth])
  useEffect(() => keepSidebarWidth(sidebarWidth), [sidebarWidth])
  // Its edge dragged past the narrowest: letting go hides it.
  const [hiding, setHiding] = useState(false)
  // A narrow window hides the sidebar, and shows it over the Strip only
  // when asked; what the Person chose for a wide one is kept (ADR 0025,
  // decision 10).
  const lookColumns = useLookColumns()
  const columnMin = lookColumns.min
  const narrow = useNarrow(columnMin, sidebarWidth)
  const [over, setOver] = useState(false)
  if (over && !narrow) setOver(false)
  const setShown = narrow ? setOver : setSidebar
  const toggleSidebar = useCallback(
    () => setShown((shows) => !shows),
    [setShown]
  )
  const showSidebar = useCallback(() => setShown(true), [setShown])
  const hideSidebar = useCallback(() => setShown(false), [setShown])
  const [overviewState, setOverview] = useState<"closed" | "open" | "closing">(
    "closed"
  )
  const overview = overviewState !== "closed"
  const [menu, setMenu] = useState<Opening | null>(null)
  const [attention, setAttention] = useState(QUIET)
  const [lists, setLists] = useState<Lists>({})

  // What is drawn, for what runs between draws; and the changes that
  // wait to see theirs drawn, each with when it is.
  const waiting = useRef(new Set<(seen: Seen) => boolean>())
  const seenNow = useRef(drawing)
  useEffect(() => {
    seenNow.current = drawing
    for (const drawn of waiting.current)
      if (drawn(drawing)) waiting.current.delete(drawn)
  }, [drawing])
  // Where the Person looks, which the notifications module asks to tell
  // of what calls (ADR 0056, decision 1), and who hears it change.
  const sightHeard = useRef(new Set<() => void>())
  const notify = useLookNotify()
  const sound = useLookSound()
  const lookNow = useRef({ notify, sound })
  useEffect(() => {
    lookNow.current = { notify, sound }
  }, [notify, sound])
  const front = useInFront()
  useEffect(() => keepSidebar(sidebar), [sidebar])
  // A Pane an Agent opened is marked until the Person looks at it: has
  // it in focus, the window in front (ADR 0032).
  const [looked, setLooked] = useState(loadLooked)
  const lookedAt = (front && !overview && focused(workspaces)) || undefined
  if (lookedAt?.by && !looked.has(lookedAt.id)) {
    // Only the Panes still there are kept.
    const now = new Set([lookedAt.id])
    for (const entry of entries(workspaces))
      if (looked.has(entry.id)) now.add(entry.id)
    setLooked(now)
  }
  useEffect(() => keepLooked(looked), [looked])
  const marked = useCallback(
    (entry: Entry) => entry.by !== undefined && !looked.has(entry.id),
    [looked]
  )

  // A Pane that leaves every workspace lets its module let go, as a
  // terminal stops its program; one moved elsewhere has not left.
  const before = useRef(workspaces)
  useEffect(() => {
    for (const entry of left(before.current, workspaces, identityOf)) {
      closedOf(engine, entry)
    }
    before.current = workspaces
  }, [engine, workspaces])

  // Changes go one after another, each worked out from what the last one
  // drew: keys pressed quickly act as they would slowly.
  const changes = useRef(Promise.resolve())
  const drawnWhen = useCallback(
    (done: (seen: Seen) => boolean) =>
      new Promise<void>((go) => {
        const drawn = (seen: Seen) => done(seen) && (go(), true)
        if (drawn(seenNow.current)) return
        waiting.current.add(drawn)
        setTimeout(() => {
          waiting.current.delete(drawn)
          go()
        }, DRAWN_WITHIN)
      }),
    []
  )
  // The engine answers in turn: a command that changed nothing finds
  // the arrangement as the last one answered left it.
  const answered = useRef(0)
  const answeredAt = useCallback((at: number | null) => {
    if (at !== null) answered.current = Math.max(answered.current, at)
    return answered.current
  }, [])
  // A change, and once drawn, the Pane it focuses; none if refused.
  const changing = useCallback(
    (how: Change) => {
      const run = async () => {
        const was = seenNow.current.state
        const next = how(was)
        if (!next || next === was) return
        if (!("command" in next)) {
          // The view alone: drawn as `next` at once.
          seenNow.current = looking(seenNow.current, viewOf(next))
          setView(() => viewOf(next))
          return focused(next)?.id
        }
        const answer = (await send(engine, next.command)) as {
          at: number | null
          pane?: string
        }
        const want =
          next.focus === false ? undefined : (next.want ?? answer.pane)
        const after = answeredAt(answer.at)
        if (want) setView((view) => ({ ...view, want: { pane: want, after } }))
        await drawnWhen(
          (seen) =>
            seen.at >= after && (!want || focused(seen.state)?.id === want)
        )
        return want
      }
      // What it focuses, once drawn; none for a change refused.
      const done = changes.current.then(run).catch(refused)
      changes.current = done.then(() => undefined)
      return done
    },
    [engine, setView, drawnWhen, answeredAt]
  )
  const change = useCallback(
    (how: Change) => changing(how).then(() => undefined),
    [changing]
  )
  // A Pane's new args are drawn at once, and kept until their event is.
  const update = useCallback(
    (pane: string, { args }: PaneState) => {
      // Drawn again only as asked, or when the engine refused: an
      // answer only says until when.
      const ask = (until: number, draw: boolean) =>
        setDrawing((was) => {
          if (until !== Infinity && was.asked[pane]?.args !== args) return was
          const seen = {
            ...was,
            asked: { ...was.asked, [pane]: { args, until } },
          }
          return draw ? looking(seen, was.view) : seen
        })
      ask(Infinity, true)
      engine.command("workspaces.update", { pane, args }).then(
        (done) => ask(answeredAt(done.at), false),
        (error) => (refused(error), ask(0, true))
      )
    },
    [engine, answeredAt]
  )
  // What calls the Person, for the Marks, the rings and Alt+U; the
  // notifications module tells of it (ADR 0056, decision 1).
  const calling = useMemo(() => callsOf(lists), [lists])
  // Alt+C's column to the middle, and a Thread picked, from the Inbox,
  // the bar or a call, to the left (ADR 0065, decision 8): once each.
  const [reveal, setReveal] = useState<Reveal>()
  const picked = useCallback((entry: string | void) => {
    if (entry) setReveal({ entry, how: "left" })
  }, [])
  // What the modules list now, for what reads it later.
  const listsNow = useRef(lists)
  // Who hears the lists change: a module, as the browser for its tabs.
  const listsHeard = useRef(new Set<() => void>())
  useEffect(() => {
    listsNow.current = lists
    for (const listener of listsHeard.current) listener()
  }, [lists])
  // A Thread picked comes to the left, once its Pane is drawn.
  const picking = useCallback(
    (how: Change) => void changing(how).then(picked),
    [changing, picked]
  )
  const goToCall = useCallback(
    (thing: Thing & { pane: PaneState }) =>
      picking((w) => answering(w, thing, homeOf(thing.pane))),
    [picking]
  )
  const heard = useRef(calling)
  useEffect(() => {
    heard.current = calling
  }, [calling])
  const answer = useCallback(() => {
    const call = first(heard.current)
    if (call) goToCall(call)
  }, [goToCall])
  useEffect(() => {
    for (const listener of sightHeard.current) listener()
  }, [workspaces, front])
  // `banda menu ROUTE` opens the menu there (ADR 0017, decision 7).
  const projectsNow = useRef(projects)
  useEffect(() => {
    projectsNow.current = projects
  }, [projects])
  // The Person archives a Thread, from its row's menu, the Banda menu or
  // Alt+S, or brings it back. Archived, it is put away: every Pane that
  // shows it closes, on any workspace (ADR 0008, decision 4; ADR 0069).
  const archiveThread = useCallback(
    (project: ProjectId, thing: string, archived: boolean) => {
      keepArchived(thing, archived)
      if (!archived) return
      const shown = { project, about: thing }
      for (const entry of entries(seenNow.current.state))
        if (isShowing(entry, shown, showsOf))
          change((w) => closingShown(w, shown))
    },
    [change]
  )
  const toggleArchived = useCallback(
    (project: ProjectId, thing: string) => {
      const archived = toggled(listsNow.current, project, thing)
      if (archived !== undefined) archiveThread(project, thing, archived)
    },
    [archiveThread]
  )
  const archive = useCallback(() => {
    const entry = focused(seenNow.current.state)
    const thing = entry && showsOf(entry.pane)
    if (entry && thing) toggleArchived(entry.project, thing)
  }, [toggleArchived])
  const toggleOverview = useCallback(
    () => setOverview((was) => (was === "open" ? "closing" : "open")),
    []
  )
  // The drawer (ADR 0025, decision 8): its Pane, kept between runs, and
  // whether it shows. Dropped with none, it gets a new Thread in the home
  // Project, the agents module's, caught before a workspace opens it.
  const [drawer, setDrawer] = useState(loadDrawer)
  const [drawerShown, setDrawerShown] = useState(false)
  // Kept from the last run, it is drawn from its first drop in this one.
  const [dropped, setDropped] = useState(false)
  useEffect(() => keepDrawer(drawer), [drawer])
  const drawerLook = useLookDrawer()
  const drawerNow = useRef(drawer)
  useEffect(() => {
    drawerNow.current = drawer
  }, [drawer])
  const toggleDrawer = useCallback(
    (parts: Parts) => {
      if (!drawerNow.current) {
        const harness = drawerLook.harness
        const catching: Parts = {
          ...parts,
          open: (pane, project) => {
            const entry = { id: newId(), project: project ?? home, pane }
            drawerNow.current = entry
            setDrawer(entry)
          },
        }
        runAction(catching, "thread.new", {
          project: home,
          ...(harness && { harness }),
        })
      }
      setDrawerShown((shown) => !shown)
      setDropped(true)
    },
    [home, drawerLook.harness]
  )
  const liftDrawer = useCallback(() => setDrawerShown(false), [])
  const closeDrawer = useCallback(() => {
    setDrawerShown(false)
    setDrawer(undefined)
  }, [])
  const changeDrawer = useCallback(
    (pane: PaneState) => setDrawer((was) => was && { ...was, pane }),
    []
  )
  // The Pane zoomed over the whole window, while it keeps the focus: the
  // focus elsewhere, or the overview, brings it back (ADR 0025, decision 4).
  const [zoom, setZoom] = useState<string>()
  const zoomed =
    zoom !== undefined && !overview && focused(workspaces)?.id === zoom
      ? zoom
      : undefined
  if (zoom !== undefined && zoomed === undefined) setZoom(undefined)
  const sidebarShown = (narrow ? over : sidebar) && !zoomed
  const hideOver = useCallback(() => setOver(false), [])
  // Each Alt+C brings the focused column to the middle, once.
  const toCenter = useCallback(() => {
    const entry = focused(seenNow.current.state)?.id
    if (entry) setReveal({ entry, how: "middle" })
  }, [])
  const toggleZoom = useCallback(
    () =>
      setZoom((was) =>
        was === undefined ? focused(seenNow.current.state)?.id : undefined
      ),
    []
  )
  const closeOverview = useCallback(() => setOverview("closing"), [])
  const leftOverview = useCallback(
    () => setOverview((was) => (was === "closing" ? "closed" : was)),
    []
  )
  // The Panes in windows of their own (ADR 0025, decision 9): main keeps
  // which, and their places here keep stand-ins.
  const [away, setAway] = useState<ReadonlySet<string>>(() => new Set())
  const awayNow = useRef(away)
  useEffect(() => {
    awayNow.current = away
  }, [away])
  useEffect(() => {
    const popped = window.banda?.popped
    if (!popped) return
    let on = true
    void popped.current().then((ids) => on && setAway(new Set(ids)))
    const stop = popped.listen((ids) => setAway(new Set(ids)))
    return () => {
      on = false
      stop()
    }
  }, [])
  // Its window opens as big as its tile.
  const popOut = useCallback((entry: string) => {
    const tile = document.querySelector(`[data-tile="${CSS.escape(entry)}"]`)
    const size = tile?.getBoundingClientRect()
    window.banda?.popped.open(entry, size?.width ?? 0, size?.height ?? 0)
  }, [])
  const togglePopOut = useCallback(() => {
    const entry = focused(seenNow.current.state)?.id
    if (!entry) return
    if (awayNow.current.has(entry)) window.banda?.popped.close(entry)
    else popOut(entry)
  }, [popOut])
  // Goes to workspace `id`, as its number does.
  const goTo = useCallback(
    (id: string) =>
      change((w) => {
        const index = w.list.findIndex((each) => each.id === id)
        return index < 0 ? undefined : go(w, index)
      }),
    [change]
  )
  // Alt+Space or Alt+K again, or the other of them, closes the menu.
  const toggleMenu = useCallback(
    (at: At) => setMenu((open) => (open ? null : openingAt(at))),
    []
  )
  const closeMenu = useCallback(() => setMenu(null), [])

  // The actions, with the Person's keys over their own (keys.toml), but
  // after the reset chord: then their own, until the file changes.
  const lookKeys = useLookKeys()
  const said = JSON.stringify([lookKeys.mod, lookKeys.binds])
  const [shipped, setShipped] = useState<string>()
  const inForce = shipped === said ? DEFAULT_KEYS : lookKeys
  const keyed = useMemo(() => rebind(ACTIONS, inForce), [inForce])
  // The keys in force, for what names them (ADR 0068, decision 4).
  const keys = useMemo(
    () => keysInForce(inForce, keyed.actions),
    [inForce, keyed]
  )
  const saidNow = useRef(said)
  useEffect(() => {
    saidNow.current = said
  }, [said])
  // The settings Pane (ADR 0016), in the focused Pane's Project.
  const settings = useCallback(
    (link?: string) =>
      change((w) => settingsAt(w, focused(w)?.project ?? home, link)),
    [change, home]
  )
  // A settings route opens the settings there; any other, the menu.
  const route = useCallback(
    (route: string) => {
      const link = settingsLinkOf(route)
      if (link === undefined) setMenu(openingOf(route, projectsNow.current))
      else settings(link)
    },
    [settings]
  )
  useEffect(() => window.banda?.menu.listen(route), [route])
  const ownKeys = useCallback(() => {
    setShipped(saidNow.current)
    settings("keys")
  }, [settings])

  const parts: Parts = useMemo(() => {
    const parts: Parts = {
      change,
      home,
      open: (pane, project, { beside, again = true, ...how } = {}) =>
        change((w) => {
          const at = beside
            ? besideOf(w, listsNow.current, beside, showsOf)
            : null
          return opening(
            w,
            project ?? at?.project ?? focused(w)?.project ?? home,
            pane,
            {
              ...how,
              ...(at?.from ? { from: at.from } : {}),
              // What an Agent opens goes into its Thread's Group; an
              // Agent's Thread, to its Project's workspace.
              place: at?.from ? "group" : homeOf(pane),
              // Not again: the one shown, as its kind names it, keeps
              // what it shows.
              ...(again ? { again } : { keep: true }),
            }
          )
        }),
      focused: () => {
        const entry = focused(seenNow.current.state)
        return entry ? { project: entry.project, pane: entry.pane } : null
      },
      beside: (agent) => {
        const at = besideOf(
          seenNow.current.state,
          listsNow.current,
          agent,
          showsOf
        )
        return at && { project: at.project, right: at.from ? at.right : null }
      },
      lists: () => listsNow.current,
      watchLists: (listener) => {
        listsHeard.current.add(listener)
        return () => listsHeard.current.delete(listener)
      },
      sight: (thing) =>
        thing
          ? sightOf(
              seenNow.current.state,
              thing,
              inFront(),
              showsOf,
              columnsOf()
            )
          : inFront()
            ? "in-window"
            : "away",
      watchSight: (listener) => {
        sightHeard.current.add(listener)
        return () => sightHeard.current.delete(listener)
      },
      goTo: goToCall,
      look: () => lookNow.current,
      projects: () => openNow.current,
      toggleSidebar,
      showSidebar,
      toggleOverview,
      drawer: () => toggleDrawer(parts),
      zoom: toggleZoom,
      popOut: togglePopOut,
      center: toCenter,
      answer,
      archive,
      menu: toggleMenu,
      route,
      ownKeys,
      settings,
      lookInto: (fingerprint) =>
        void lookingInto(engine, fingerprint)
          .then((thread) => runAction(parts, "thread.new", thread))
          .catch(() => undefined),
      run: (action, args) => runAction(parts, action, args),
      writeSetting: (file, key, value) =>
        window.banda?.settings.set(file, key, value) ??
        Promise.resolve(["Only Banda's app writes the settings."]),
    }
    return parts
  }, [
    change,
    home,
    goToCall,
    toggleSidebar,
    showSidebar,
    toggleOverview,
    toggleDrawer,
    toggleZoom,
    togglePopOut,
    toCenter,
    answer,
    archive,
    toggleMenu,
    route,
    ownKeys,
    settings,
    engine,
  ])
  // Each module that runs starts once, with the window as it is when it
  // asks (ADR 0022): the browser opens a Pane for an Agent's tab.
  const partsNow = useRef(parts)
  useEffect(() => {
    partsNow.current = parts
  }, [parts])
  // A new Problem of Banda's own tells too, silently (ADR 0039).
  const run = useCallback(
    (action: string, args: Args) => partsNow.current.run(action, args),
    []
  )
  useProblemNews(engine, notify, run)
  const running = known
    .filter((module) => runs(module, modules))
    .map((module) => module.id)
    .join()
  useEffect(() => {
    const api: WindowApi = {
      get home() {
        return partsNow.current.home
      },
      open: (...how) => partsNow.current.open(...how),
      focused: () => partsNow.current.focused(),
      beside: (agent) => partsNow.current.beside(agent),
      lists: () => partsNow.current.lists(),
      watchLists: (listener) => partsNow.current.watchLists(listener),
      run: (...how) => partsNow.current.run(...how),
      sight: (thing) => partsNow.current.sight(thing),
      watchSight: (listener) => partsNow.current.watchSight(listener),
      goTo: (thing) => partsNow.current.goTo(thing),
      look: () => partsNow.current.look(),
      projects: () => partsNow.current.projects(),
      writeSetting: (...how) => partsNow.current.writeSetting(...how),
    }
    const stops = known
      .filter((module) => running.split(",").includes(module.id))
      .flatMap((module) => module.start?.(api) ?? [])
    return () => stops.forEach((stop) => stop())
  }, [running])
  // The keys run the actions, before any Pane hears them. A dialog keeps
  // its keys, as the Banda menu its Alt+Enter, but for the menu's own.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A press the window handed on is the program's.
      if (HANDED.has(event)) return
      const target = event.target instanceof Element ? event.target : null
      // A field that takes a key to bind takes every key.
      if (target?.closest("[data-takes-keys]")) return
      const action = actionFor(keyed.actions, event)
      if (!action) return handOn(event, target, keyed.actions)
      // A dialog that takes the window's keys, as the overview, has only
      // the plain ones of its own.
      const inDialog =
        target?.closest("[role=dialog]:not([data-window-keys])") != null
      if (inDialog && !action.overDialogs) return
      // A terminal leaves alone a key that was taken.
      event.preventDefault()
      event.stopPropagation()
      // Held, it runs what it says it runs then, as an arrow that stops
      // at an edge.
      const held = event.repeat ? action.whenHeld : undefined
      const running = held
        ? (keyed.actions.find((one) => one.id === held) ?? action)
        : action
      running.run(parts)
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [parts, keyed])
  // A row of the sidebar or the menu opens its Pane, where a workspace
  // shows it or in a new column; a Project gets a new Thread.
  const openPane = useCallback(
    (project: ProjectId, pane: PaneState) =>
      change((w) => opening(w, project, pane, { place: "right" })),
    [change]
  )
  const pickPane = useCallback(
    (project: ProjectId, pane: PaneState) =>
      picking((w) => opening(w, project, pane, { place: homeOf(pane) })),
    [picking]
  )
  // Pinned, the drawer's Thread is a column of the workspace on screen.
  const pinDrawer = useCallback(() => {
    const entry = drawerNow.current
    closeDrawer()
    if (entry) openPane(entry.project, entry.pane)
  }, [closeDrawer, openPane])
  // A new Thread is the agents module's, as its key's (`thread.new`).
  const startThread = useCallback(
    (project: ProjectId, ask?: string) =>
      parts.run("thread.new", { project, ...(ask && { ask }) }),
    [parts]
  )
  // A Project whose folder is missing finds it first (ADR 0026).
  const newThreadIn = useCallback(
    (project: ProjectId, ask?: string) =>
      projectsNow.current.find((one) => one.id === project)?.missing
        ? route(locateRoute(project))
        : startThread(project, ask),
    [startThread, route]
  )
  // The Project the focused Pane is in: where the menu's New Thread starts.
  const here = focused(workspaces)?.project ?? home
  // The bar's widgets, the window's own and the modules', where the
  // look's `[bar]` puts them (ADR 0024).
  const listed = useCallback(
    (entry: Entry) => {
      const thing = showsOf(entry.pane)
      return thing
        ? lists[entry.project]?.find((row) => row.id === thing)
        : undefined
    },
    [lists]
  )
  // The Agent's Thread in front, which the bar names with the sidebar
  // hidden (ADR 0065, decision 9).
  const ahead = focused(workspaces)
  const aheadRow = ahead && listed(ahead)
  const agentAhead = aheadRow?.agent !== undefined ? aheadRow : undefined
  const bar = useWidgets(modules, {
    engine,
    projects,
    project: here,
    window: parts,
    lists,
    sidebarShown,
    current: agentAhead,
    onOpen: pickPane,
    aside: (ready && live.view.aside) || null,
  })
  // A widget moved with Alt writes the parts of `[bar]` it changed, one
  // after another, as they are one file (ADR 0064).
  const arrangeBar = useCallback(
    (after: Layout) => {
      const changed = PARTS.filter(
        (part) =>
          after[part].length !== bar.listed[part].length ||
          after[part].some((id, i) => bar.listed[part][i] !== id)
      )
      void changed.reduce(
        (before, part) =>
          before.then(() =>
            parts
              .writeSetting(
                "look.toml",
                `bar.${part}`,
                tomlOf([...after[part]])
              )
              .then((wrong) => {
                if (wrong.length > 0) console.warn(...wrong)
              })
          ),
        Promise.resolve()
      )
    },
    [bar.listed, parts]
  )
  const choose = useCallback(
    (row: Exclude<Choice, Branch | Own>) => {
      switch (row.kind) {
        case "thread":
          return row.beside
            ? change((w) => bringing(w, row.project, row.listed.pane))
            : openPane(row.project, row.listed.pane)
        case "action":
          return row.action.run(parts)
        case "ask":
          return newThreadIn(row.project ?? here, row.words || undefined)
        case "archive":
          return toggleArchived(row.project, row.listed.id)
        case "preset":
          return pickPreset(row.name)
        case "found":
          return row.row.run(parts)
      }
    },
    [change, openPane, newThreadIn, parts, here, toggleArchived]
  )

  const frame: Frame = useMemo(
    () => ({
      // A tile takes the focus as the DOM gives it, on the workspace on
      // screen; by its turn, the Person may have gone to another.
      focus: (entry) =>
        change((w) =>
          current(w).columns.some((c) => c.entries.some((e) => e.id === entry))
            ? focusEntry(w, entry)
            : undefined
        ),
      open: (project, pane, from, place) =>
        change((w) => opening(w, project, pane, { from, place })),
      update,
      close: (entry) => change(() => closing(entry)),
      run: parts.run,
      arrange: (plan) => change(() => plan),
      popOut,
      // As the window draws it now, when the menu opens.
      stand: (entry) => {
        const state = seenNow.current.state
        const spot = find(state, entry)
        if (!spot) return undefined
        const workspace = state.list[spot.workspace]
        const column = workspace?.columns[spot.column]
        if (!workspace || !column) return undefined
        const look = columnsOf()
        return {
          width: share(widthIn(workspace, column, look)) ?? 0.5,
          full: column.full === true,
          deck: displayOf(column, look) === "deck",
          panes: column.entries.length,
          height: heightsOf(column)[spot.entry] ?? 1,
          left: spot.column > 0,
          right: spot.column < workspace.columns.length - 1,
          workspace: spot.workspace + 1,
          workspaces: state.list.length,
          away: awayNow.current.has(entry),
          presets: look.presets,
          heights: look.heights,
          floor: floorOf(workspace.id, minOf(column, look.min)),
        }
      },
    }),
    [change, update, parts, popOut]
  )
  // What a Pane in its own window asks, the window does, as for its own.
  useEffect(
    () =>
      window.banda?.popped.asked((asked) => {
        if ("open" in asked) {
          const { project, pane, from, place } = asked.open
          frame.open(project, pane, from, place)
        } else if ("run" in asked) {
          parts.run(asked.run.action, asked.run.args)
        }
      }),
    [frame, parts]
  )
  const called = useCallback(
    (entry: Entry) =>
      calling.find((call) => isShowing(entry, call, showsOf))?.chime,
    [calling]
  )
  const projectName = useCallback(
    (id: ProjectId) =>
      projects.find((project) => project.id === id)?.name || "No Project",
    [projects]
  )

  // The bar's workspaces: a Project's by its name, with a dot while one of
  // its Threads calls (ADR 0065, decision 9).
  const archived = useIsArchived()
  const barWorkspaces = useMemo(
    () =>
      inBar(workspaces).map((w) =>
        w.project
          ? {
              ...w,
              owner: projects.find((project) => project.id === w.project),
              calls: (lists[w.project] ?? []).some(
                (row) => waits(row.mark) && !archived(row)
              ),
            }
          : w
      ),
    [workspaces, lists, projects, archived]
  )

  return (
    <KeysInForce.Provider value={keys}>
      <div className="flex h-svh flex-col bg-desk text-foreground">
        <Watches
          engine={engine}
          modules={modules}
          projects={open}
          onChange={setAttention}
          onLists={setLists}
        />
        <Bar
          status={status}
          attention={attention}
          workspaces={barWorkspaces}
          map={mapOf(current(workspaces), lookColumns, listed)}
          current={workspaces.current}
          sidebar={narrow ? over : sidebar}
          onSidebar={toggleSidebar}
          problems={[...keyed.problems, ...bar.problems]}
          widgets={bar.parts}
          listed={bar.listed}
          onArrange={arrangeBar}
          working={
            Object.values(lists)
              .flat()
              .filter((listed) => works(listed.mark)).length
          }
          onPick={(index) =>
            index === workspaces.current
              ? toggleOverview()
              : change((w) => go(w, index))
          }
        />
        <div
          className="relative flex min-h-0 flex-1"
          data-sidebar-shown={(sidebarShown && !narrow) || undefined}
        >
          {sidebarShown && (
            <Sidebar
              engine={engine}
              over={narrow}
              onDismiss={narrow ? hideOver : undefined}
              onMenu={() => setMenu(openingAt("root"))}
              onSettings={() => settings()}
              onKeys={() => setMenu(openingAt("actions"))}
              hiding={hiding}
              projects={projects}
              lists={lists}
              home={home}
              isCurrent={(project, pane) => {
                const entry = focused(workspaces)
                return (
                  entry !== undefined &&
                  samePane(entry, { project, pane }, identityOf)
                )
              }}
              onOpen={pickPane}
              onNewThread={newThreadIn}
              onNoProject={() => machine && startThread(machine)}
              onArchive={archiveThread}
              onAddProject={() => parts.run("project.add")}
              onPin={(project, pinned) =>
                updateProject(engine, { project, pinned }).catch(
                  (error: unknown) =>
                    console.error("banda: the Project was not pinned", error)
                )
              }
              onProjectSettings={(project) => settings(`projects/${project}`)}
              onLocate={(project) => route(locateRoute(project))}
            />
          )}
          {sidebarShown && !narrow && (
            <Edge
              width={sidebarWidth}
              columnMin={columnMin}
              onWidth={setSidebarWidth}
              onHide={hideSidebar}
              onHiding={setHiding}
            />
          )}
          <main
            className="relative min-h-0 min-w-0 flex-1"
            // A click beside the sidebar over the Strip hides it.
            onPointerDown={narrow && sidebarShown ? hideOver : undefined}
          >
            {ready && (
              <Workspaces
                workspaces={workspaces}
                covered={overview || drawerShown}
                overview={overview}
                engine={engine}
                modules={modules}
                projectName={projectName}
                called={called}
                marked={marked}
                away={away}
                zoomed={zoomed}
                reveal={reveal}
                listed={listed}
                frame={frame}
                onStep={(by) => change((w) => step(w, by))}
                onGo={goTo}
                onStart={(pane) =>
                  // Started on this workspace, it opens here, whatever its
                  // kind's home.
                  change((w) =>
                    opening(w, focused(w)?.project ?? home, pane, {
                      place: "right",
                      again: true,
                    })
                  )
                }
              />
            )}
            <Toaster />
            <BandaMenu
              opening={menu}
              onClose={closeMenu}
              onChoose={choose}
              onAdded={(project) => {
                // As the engine answered it: the list may not know it yet.
                onCreated(project)
                startThread(project.id)
              }}
              engine={engine}
              modules={modules}
              project={here}
              lists={lists}
              projects={projects.filter((project) => !project.scratch)}
              actions={keyed.actions}
              binds={inForce.binds}
            />
            {drawer && dropped && (
              <Drawer
                entry={drawer}
                shown={drawerShown}
                height={drawerLook.height}
                engine={engine}
                modules={modules}
                listed={listed(drawer)}
                projectName={projectName}
                frame={frame}
                onLift={liftDrawer}
                onPin={pinDrawer}
                onChange={changeDrawer}
                onClose={closeDrawer}
              />
            )}
            {overview && (
              <Overview
                open={overviewState === "open"}
                onExited={leftOverview}
                workspaces={workspaces}
                projectName={projectName}
                listed={listed}
                called={called}
                frame={frame}
                onPick={(entry) => change((w) => focusEntry(w, entry))}
                onArrow={(direction) => change((w) => across(w, direction))}
                onGo={goTo}
                onClose={closeOverview}
              />
            )}
          </main>
        </div>
      </div>
    </KeysInForce.Provider>
  )
}
