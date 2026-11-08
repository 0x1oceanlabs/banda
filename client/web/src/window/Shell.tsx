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
import { Toaster, toast } from "@banda/ui/components/sonner"
import { clock, problem } from "@banda/ui/lib/words"
import { inFront, useInFront } from "@banda/ui/hooks/use-in-front"
import { useMachine } from "@banda/ui/hooks/use-status"
import { openProjects, updateProject } from "@banda/ui/lib/projects"
import { useStore } from "@banda/ui/lib/store"
import { asleep, type Listed, type PaneState } from "@banda/ui/pane"
import type { Thing } from "@banda/ui/module"
import { Bar } from "../bar/Bar"
import { WorkspaceMap } from "../bar/Map"
import { tomlOf } from "@banda/contract/settings"
import { useWidgets } from "../bar/Widgets"
import type { Layout } from "../bar/arrange"
import { PARTS } from "../bar/placed"
import { Watches } from "../bar/Watches"
import { besideOf, isShowing, nextCall, sightOf } from "../calls/sight"
import {
  followCalls,
  listedIn,
  newStores,
  nowOf,
  StoresContext,
  watchLists,
  workingIn,
} from "../calls/stores"
import { sidebarOrder } from "../sidebar/order"
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
  sources,
} from "../registry"
import { Edge } from "../sidebar/Edge"
import { Sidebar } from "../sidebar/Sidebar"
import { pickPreset } from "../sidebar/settings"
import { SnoozePicker, type Snoozing } from "../sidebar/SnoozePicker"
import { QuitDialog } from "./Quit"
import {
  seeWoke,
  snoozeAct,
  useSnoozesAt,
  wokeAt,
  wokeTold,
} from "../sidebar/snoozed"
import { archive as keepArchived, toggled } from "../sidebar/archived"
import { attachTo, focusedOn } from "./attach"
import { useNarrow } from "./narrow"
import { floorOf, type Reveal, shownOf } from "../tiling/layout"
import type { Change } from "../tiling/arrange"
import type { Shows } from "../tiling/shows"
import { useTiling } from "../tiling/useTiling"
import {
  current,
  displayOf,
  type Entry,
  entries,
  find,
  focused,
  focusedColumn,
  across,
  focusEntry,
  go,
  heightsOf,
  inBar,
  left,
  projectIn,
  samePane,
  share,
  step,
  widthIn,
} from "../tiling/model"
import { soloing, unsoloing } from "../tiling/groups"
import { AGENTS_FILE } from "@banda/contract/agents"
import { useFile } from "@banda/ui/lib/look"
import { Drawer } from "./Drawer"
import { Peek, type Peeked } from "./Peek"
import { Overview } from "../tiling/Overview"
import type { Frame } from "../tiling/PaneFrame"
import {
  keepDrawer,
  keepLooked,
  keepSidebar,
  keepSidebarWidth,
  loadDrawer,
  loadLooked,
  loadSidebar,
  loadSidebarWidth,
} from "../tiling/store"
import { Workspaces } from "../tiling/Workspaces"
import {
  answering,
  bringing,
  closing,
  closingShown,
  opening,
  runAction,
  settingsAt,
  updating,
  type Shell as Parts,
  type SnoozeAsked,
  windowApiOf,
} from "./actions"
import { KeysInForce } from "@banda/ui/hooks/use-key-of"
import { ThreadMenus } from "../titles/ThreadMenu"
import { device } from "./device"
import { useKeyRouter, useKeys, usePeekEsc } from "./keys"
import { useSteady } from "./steady"

/** The modules' sources, as a route names one for the menu to show alone. */
const menuSources = sources.map(({ source }) => source)

/**
 * The window (ADR 0005): the bar on top, the sidebar docked on the left,
 * and the workspaces, or the overview of them all. It holds what they
 * share, the workspaces, which parts show and what the modules call the
 * Person for, tells them of each call where they will notice it, and runs
 * the actions that change them.
 */
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
  // The Tiling: the engine's arrangement, the view of it and the queue
  // its changes go through (ADR 0087).
  const machine = useMachine(engine)
  const { ready, aside, workspaces, drawnNow, changing, change, update } =
    useTiling({ engine, machine, modules, home })
  // A start that drew its workspaces and stayed up went well (ADR 0039).
  useEffect(() => {
    if (!ready) return
    const well = setTimeout(wentWell, WELL)
    return () => clearTimeout(well)
  }, [ready])
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

  // The Panes that had the focus, for where an App's attach goes.
  const focusedId = focused(workspaces)?.id
  useEffect(() => {
    if (focusedId) focusedOn(focusedId)
  }, [focusedId])
  // Where the Person looks, which the notifications module asks to tell
  // of what calls (ADR 0056, decision 1), and who hears it change.
  const sightHeard = useRef(new Set<() => void>())
  const notify = useLookNotify()
  const sound = useLookSound()
  const told = useMemo(() => ({ notify, sound }), [notify, sound])
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

  // What the Apps list and what calls the Person, for the Marks, the
  // rings and Alt+U, kept outside React: a list that changes draws again
  // only what reads it (ADR 0088, decision 7). The notifications module
  // tells of what calls (ADR 0056, decision 1). Snoozes are read by a
  // clock that moves as the next one wakes (ADR 0074): a Thread that
  // sleeps calls no one, and calls again as it wakes.
  const [stores] = useState(newStores)
  useEffect(() => followCalls(stores), [stores])
  const snoozes = useSnoozesAt(useStore(stores.calls, nowOf))
  // What the Tiling reads of them, the same for the Window's life. The
  // calls follow every change of the items, so it hears them alone.
  const [shows] = useState((): Shows => ({
    listed: (entry) => listedIn(stores.items.get(), entry, showsOf),
    called: (entry) =>
      stores.calls.get().list.find((call) => isShowing(entry, call, showsOf))
        ?.chime,
    subscribe: stores.calls.subscribe,
  }))
  // Alt+C's column to the middle, and a Thread picked, from the Inbox,
  // the bar or a call, to the left (ADR 0065, decision 8): once each.
  const [reveal, setReveal] = useState<Reveal>()
  const picked = useCallback((entry: string | void) => {
    if (entry) setReveal({ entry, how: "left" })
  }, [])
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
  const closeShown = useCallback(
    (project: ProjectId, thing: string) => {
      const shown = { project, about: thing }
      for (const entry of entries(drawnNow()))
        if (isShowing(entry, shown, showsOf))
          change((w) => closingShown(w, shown))
    },
    [change, drawnNow]
  )
  const listedOf = useCallback(
    (project: ProjectId, thing: string): Listed | undefined =>
      stores.items.get()[project]?.find((listed) => listed.id === thing),
    [stores]
  )
  // A snooze is the engine's (ADR 0074). Snoozed, a Thread is put away as
  // an archived one is, its Panes closed, and it leaves Archive; Undo
  // wakes it.
  const [snoozing, setSnoozing] = useState<Snoozing>()
  // How many Agents worked as the Person asked to quit, while Banda asks
  // whether to stop them (ADR 0086, decision 3).
  const [quitting, setQuitting] = useState<number | null>(null)
  const wakeThread = useCallback(
    (project: ProjectId, thing: string) => {
      engine
        .command("agents.wake", { thread: thing }, project)
        .catch((error: unknown) => toast.error(problem(error)))
    },
    [engine]
  )
  const snoozeThread = useCallback(
    (project: ProjectId, listed: Listed, until?: number, resume = false) => {
      const thread = listed.id
      const asked = until === undefined ? { thread } : { thread, until, resume }
      engine.command("agents.snooze", asked, project).then(
        () => {
          closeShown(project, thread)
          toast(
            until === undefined
              ? "Snoozed until it's done"
              : `Snoozed until ${clock(until)}`,
            {
              action: {
                label: "Undo",
                onClick: () => wakeThread(project, thread),
              },
            }
          )
        },
        (error: unknown) => toast.error(problem(error))
      )
    },
    [engine, closeShown, wakeThread]
  )
  const archiveThread = useCallback(
    (project: ProjectId, thing: string, archived: boolean) => {
      // Archived, a snoozed Thread's snooze ends.
      const listed = listedOf(project, thing)
      if (archived && listed && asleep(listed, Date.now()))
        wakeThread(project, thing)
      keepArchived(thing, archived)
      if (archived) closeShown(project, thing)
    },
    [closeShown, wakeThread, listedOf]
  )
  const toggleArchived = useCallback(
    (project: ProjectId, thing: string) => {
      const archived = toggled(stores.items.get(), project, thing)
      if (archived !== undefined) archiveThread(project, thing, archived)
    },
    [archiveThread, stores]
  )
  const archive = useCallback(() => {
    const entry = focused(drawnNow())
    const thing = entry && showsOf(entry.pane)
    if (entry && thing) toggleArchived(entry.project, thing)
  }, [toggleArchived, drawnNow])
  /** The Thread of the Pane in focus, as its Project lists it. */
  const threadInFocus = useCallback((): Snoozing | undefined => {
    const entry = focused(drawnNow())
    const thing = entry && showsOf(entry.pane)
    const listed = entry && thing ? listedOf(entry.project, thing) : undefined
    return entry && listed ? { project: entry.project, listed } : undefined
  }, [drawnNow, listedOf])
  // A Thread that woke stops saying so once its Person looks at it.
  useEffect(() => {
    const see = () => {
      const looked = threadInFocus()
      if (looked) seeWoke(looked.listed)
    }
    see()
    return stores.items.subscribe(see)
  }, [threadInFocus, workspaces, stores])
  /** What the Pane menu offers for the Thread a Pane shows: to snooze it,
   * to wake it, or nothing. */
  const snoozeIn = useCallback(
    (entry: Entry | undefined) => {
      const thing = entry && showsOf(entry.pane)
      const listed = entry && thing ? listedOf(entry.project, thing) : undefined
      return listed && snoozeAct(listed, asleep(listed, Date.now()))
    },
    [listedOf]
  )
  // The Thread menu's Snooze…: the picker for its Thread.
  const openSnooze = useCallback(
    (project: ProjectId, listed: Listed) => setSnoozing({ project, listed }),
    []
  )
  // Alt+Z: the picker for the Thread the Person looks at.
  /** The Thread `asked` names, else the one in focus. */
  const threadAsked = useCallback(
    ({ thread }: SnoozeAsked): Snoozing | undefined => {
      if (!thread) return threadInFocus()
      const listed = listedOf(thread.project, thread.id)
      return listed && { project: thread.project, listed }
    },
    [threadInFocus, listedOf]
  )
  const snooze = useCallback(
    (asked: SnoozeAsked) => {
      const target = threadAsked(asked)
      if (target && asked.until !== undefined)
        snoozeThread(target.project, target.listed, asked.until, asked.resume)
      else setSnoozing(target)
    },
    [threadAsked, snoozeThread]
  )
  const wake = useCallback(
    (asked: SnoozeAsked) => {
      const target = threadAsked(asked)
      if (target) wakeThread(target.project, target.listed.id)
    },
    [threadAsked, wakeThread]
  )
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
  // Quick Look's tile over the desk (ADR 0073, decision 7): one Pane, in
  // no workspace, and whether it fills the desk. Esc closes it, unless a
  // menu or a dialog over it takes the Esc first.
  const [peek, setPeek] = useState<Peeked | null>(null)
  const peekNow = useRef(peek)
  useEffect(() => {
    peekNow.current = peek
  }, [peek])
  const closePeek = useCallback(() => setPeek(null), [])
  const fillPeek = useCallback(() => {
    if (!peekNow.current) return false
    setPeek((was) => was && { ...was, fill: !was.fill })
    return true
  }, [])
  usePeekEsc(peek !== null, closePeek)
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
    const entry = focused(drawnNow())?.id
    if (entry) setReveal({ entry, how: "middle" })
  }, [drawnNow])
  const toggleZoom = useCallback(
    () =>
      setZoom((was) =>
        was === undefined ? focused(drawnNow())?.id : undefined
      ),
    [drawnNow]
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
  useEffect(() => device.popped.follow(setAway), [])
  // Its window opens as big as its tile.
  const popOut = useCallback((entry: string) => {
    const tile = document.querySelector(`[data-tile="${CSS.escape(entry)}"]`)
    const size = tile?.getBoundingClientRect()
    device.popped.open(entry, size?.width ?? 0, size?.height ?? 0)
  }, [])
  const togglePopOut = useCallback(() => {
    const entry = focused(drawnNow())?.id
    if (!entry) return
    if (awayNow.current.has(entry)) device.popped.close(entry)
    else popOut(entry)
  }, [popOut, drawnNow])
  // Goes to workspace `id`, as its number does.
  const goTo = useCallback(
    (id: string) =>
      change((w) => {
        const index = w.list.findIndex((each) => each.id === id)
        return index < 0 ? undefined : go(w, index)
      }),
    [change]
  )
  // A swipe up or down with the mod held steps once; a first Pane
  // started on an empty workspace opens there, in its Project, whatever
  // its kind's home.
  const stepBy = useCallback(
    (by: 1 | -1) => change((w) => step(w, by)),
    [change]
  )
  const startHere = useCallback(
    (pane: PaneState) =>
      change((w) =>
        opening(w, projectIn(w) ?? home, pane, { place: "right", again: true })
      ),
    [change, home]
  )
  // Alt+Space or Alt+K again, or the other of them, closes the menu.
  const toggleMenu = useCallback(
    (at: At) => setMenu((open) => (open ? null : openingAt(at))),
    []
  )
  const closeMenu = useCallback(() => setMenu(null), [])

  // The actions with the keys in force (keys.ts).
  const { mod, binds, keyed, keys, own } = useKeys()
  // The settings Pane (ADR 0016), in the Project the Person is in.
  const settings = useCallback(
    (link?: string) => change((w) => settingsAt(w, projectIn(w) ?? home, link)),
    [change, home]
  )
  // A settings route opens the settings there; any other, the menu.
  const route = useCallback(
    (route: string) => {
      const link = settingsLinkOf(route)
      if (link === undefined)
        setMenu(openingOf(route, projectsNow.current, menuSources))
      else settings(link)
    },
    [settings]
  )
  useEffect(() => device.menu.listen(route), [route])
  const ownKeys = useCallback(() => {
    own()
    settings("keys")
  }, [own, settings])
  const quit = useCallback(() => {
    const working = workingIn(stores.items.get())
    if (working === 0) device.quit()
    else setQuitting(working)
  }, [stores])

  // The action context (ADR 0088, decision 7): made afresh with each
  // drawing, and held steady, so the keys' listener, the Tiles' frame and
  // the widgets that hold it are never made again.
  const parts = useSteady<Parts>({
    change,
    home,
    open: (pane, project, { beside, again = true, update, ...how } = {}) => {
      // The Pane that peeks, opened in the workspace, peeks no more.
      const peeked = peekNow.current
      if (
        peeked &&
        samePane(
          { project: project ?? peeked.project, pane },
          peeked,
          identityOf
        )
      )
        setPeek(null)
      change((w) => {
        const at = beside
          ? besideOf(w, stores.items.get(), beside, showsOf)
          : null
        // Not again: the one shown, as its kind names it, keeps what it
        // shows, or takes these args when asked to update it.
        return (again || !update ? opening : updating)(
          w,
          project ?? at?.project ?? projectIn(w) ?? home,
          pane,
          {
            ...how,
            ...(at?.from ? { from: at.from } : {}),
            // What an Agent opens goes into its Thread's Group; an
            // Agent's Thread, to its Project's workspace.
            place: at?.from ? "group" : homeOf(pane),
            ...(again ? { again } : { keep: true }),
          }
        )
      })
    },
    focused: () => {
      const entry = focused(drawnNow())
      if (!entry) return null
      const shows = showsOf(entry.pane)
      return {
        project: entry.project,
        pane: entry.pane,
        ...(shows ? { shows } : {}),
      }
    },
    beside: (agent) => {
      const at = besideOf(drawnNow(), stores.items.get(), agent, showsOf)
      return at && { project: at.project, right: at.from ? at.right : null }
    },
    lists: () => stores.items.get(),
    watchLists: (listener) => watchLists(stores, listener),
    sight: (thing) => {
      if (!thing) return inFront() ? "in-window" : "away"
      const state = drawnNow()
      const look = columnsOf()
      // What shows is measured as it is asked, only for a Tile on the
      // workspace on screen (ADR 0087, decision 9).
      return sightOf(state, thing, inFront(), showsOf, {
        look,
        shown: () => shownOf(current(state), look),
        away: awayNow.current,
        // Under a zoom no other Tile shows.
        zoomed: zoomed !== undefined,
      })
    },
    watchSight: (listener) => {
      sightHeard.current.add(listener)
      return () => sightHeard.current.delete(listener)
    },
    goTo: goToCall,
    look: () => told,
    projects: () => open,
    toggleSidebar,
    showSidebar,
    toggleOverview,
    drawer: () => toggleDrawer(parts),
    zoom: toggleZoom,
    popOut: togglePopOut,
    center: toCenter,
    // Alt+U: the next call below the Thread in front, as the sidebar lists
    // them (ADR 0079, decision 4).
    answer: () => {
      const order = sidebarOrder(stores.items.get(), projects, snoozes)
      const entry = focused(drawnNow())
      const thing = entry && showsOf(entry.pane)
      const here = entry && thing ? `${entry.project}:${thing}` : undefined
      const call = nextCall(stores.calls.get().list, order, here)
      if (call) goToCall(call)
    },
    archive,
    snooze,
    wake,
    menu: toggleMenu,
    fillPeek,
    peek: (pane, project) =>
      setPeek((was) =>
        pane
          ? {
              pane,
              project: project ?? projectIn(drawnNow()) ?? home,
              fill: was?.fill ?? false,
            }
          : null
      ),
    route,
    ownKeys,
    settings,
    quit,
    lookInto: (fingerprint) =>
      void lookingInto(engine, fingerprint)
        .then((thread) => runAction(parts, "thread.new", thread))
        .catch(() => undefined),
    run: (action, args) => runAction(parts, action, args),
    engine,
    writeSetting: device.settings.set,
    attach: (chips) => {
      const at = focused(drawnNow())
      const to = attachTo(at ? { id: at.id, project: at.project } : null)
      if (!to) {
        // One toast, however many files were added at once.
        toast.warning("No Thread in this Project to add it to.", {
          id: "attach",
        })
        return
      }
      change((w) => focusEntry(w, to.entry))
      to.take(Array.isArray(chips) ? chips : [chips])
    },
  })
  // A Thread that woke by itself is told of once (ADR 0074, decision 7):
  // one that calls, by its call; one that does not, here. Looked at as the
  // calls follow the lists and the snooze clock.
  useEffect(() => {
    let sleeping = new Set<string>()
    const look = () => {
      const was = sleeping
      const lists = stores.items.get()
      const { now, list } = stores.calls.get()
      const calls = new Set(list.map((call) => call.key))
      sleeping = new Set()
      for (const [project, listed] of Object.entries(lists))
        for (const one of listed) {
          if (!one.snooze) continue
          const key = `${project}:${one.id}`
          const slept = `${key}@${one.snooze.at}`
          if (asleep(one, now)) sleeping.add(slept)
          else if (
            was.has(slept) &&
            !calls.has(key) &&
            wokeAt(one, now) !== undefined
          )
            parts.run("notifications.tell", wokeTold(project as ProjectId, one))
        }
    }
    look()
    return stores.calls.subscribe(look)
  }, [stores, parts])
  // A new Problem of Banda's own tells too, silently (ADR 0039).
  useProblemNews(engine, notify, parts.run)
  // What the modules are given of it: the API alone.
  const [api] = useState(() => windowApiOf(parts))
  // Each module that runs starts once, with the window as it is when it
  // asks (ADR 0022): the browser opens a Pane for an Agent's tab.
  const running = known
    .filter((module) => runs(module, modules))
    .map((module) => module.id)
    .join()
  useEffect(() => {
    const stops = known
      .filter((module) => running.split(",").includes(module.id))
      .flatMap((module) => module.start?.(api) ?? [])
    return () => stops.forEach((stop) => stop())
  }, [running, api])
  // The keys run the actions, before any Pane hears them (keys.ts).
  useKeyRouter(parts, keyed, mod)
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
  // The Project the Person is in: where the menu's New Thread starts, on
  // an empty Project workspace too.
  const here = projectIn(workspaces) ?? home
  // Solo (ADR 0079, decision 2): when the focus comes to another Agent,
  // its Group fills the screen. Only a move of the focus asks, so Alt+M
  // still gives the room back by hand. From solo to the row, the room
  // comes back on the workspace in view.
  const flow = useFile(AGENTS_FILE).flow
  const at = focusedColumn(workspaces)
  const soloAt =
    flow === "solo" && at.column
      ? `${at.workspace.id} ${at.column.group ?? at.column.id}`
      : undefined
  useEffect(() => {
    if (!soloAt) return
    const lists = stores.items.get()
    change((w) =>
      soloing(
        w,
        (entry) => listedIn(lists, entry, showsOf)?.agent !== undefined
      )
    )
  }, [soloAt, change, stores])
  const flowWas = useRef(flow)
  useEffect(() => {
    if (flowWas.current === "solo" && flow !== "solo") change(unsoloing)
    flowWas.current = flow
  }, [flow, change])
  // The bar's widgets, the window's own and the modules', where the
  // look's `[bar]` puts them (ADR 0024); the thing the Pane in front
  // shows, whose Agent's Thread the bar names with the sidebar hidden (ADR
  // 0065, decision 9), the same object while it stays in front.
  const aheadEntry = focused(workspaces)
  const aheadProject = aheadEntry?.project
  const aheadThing = aheadEntry && showsOf(aheadEntry.pane)
  const ahead = useMemo(
    () =>
      aheadProject && aheadThing
        ? { project: aheadProject, thing: aheadThing }
        : undefined,
    [aheadProject, aheadThing]
  )
  const bar = useWidgets(modules, {
    engine,
    projects,
    project: here,
    window: api,
    sidebarShown,
    ahead,
    onOpen: pickPane,
    aside,
  })
  // A widget moved with the mod writes the parts of `[bar]` it changed, one
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
  // A Project the menu added, as the engine answered it: the list may not
  // know it yet. The menu offers no scratch Space's.
  const added = useCallback(
    (project: ProjectSummary) => {
      onCreated(project)
      startThread(project.id)
    },
    [onCreated, startThread]
  )
  const menuProjects = useMemo(
    () => projects.filter((project) => !project.scratch),
    [projects]
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
        case "snooze":
          return setSnoozing({ project: row.project, listed: row.listed })
        case "wake":
          return wakeThread(row.project, row.listed.id)
        case "preset":
          return pickPreset(row.name)
        case "found":
          return row.row.run(parts)
      }
    },
    [change, openPane, newThreadIn, parts, here, toggleArchived, wakeThread]
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
        const state = drawnNow()
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
          snooze: snoozeIn(column.entries[spot.entry]),
        }
      },
    }),
    [change, update, parts, popOut, snoozeIn, drawnNow]
  )
  // What a Pane in its own window asks, the window does, as for its own.
  useEffect(
    () =>
      device.popped.asked((asked) => {
        if ("open" in asked) {
          const { project, pane, from, place } = asked.open
          frame.open(project, pane, from, place)
        } else if ("run" in asked) {
          parts.run(asked.run.action, asked.run.args)
        }
      }),
    [frame, parts]
  )
  const projectOf = useCallback(
    (id: ProjectId) => projects.find((project) => project.id === id),
    [projects]
  )

  // The bar's workspaces: a Project's by its name (ADR 0065, decision 9).
  const barWorkspaces = useMemo(
    () =>
      inBar(workspaces).map((w) =>
        w.project ? { ...w, owner: projectOf(w.project) } : w
      ),
    [workspaces, projectOf]
  )

  return (
    <KeysInForce.Provider value={keys}>
      <StoresContext.Provider value={stores}>
        <ThreadMenus
          engine={engine}
          projects={projects}
          archive={archiveThread}
          snooze={openSnooze}
          wake={wakeThread}
        >
          <div className="flex h-svh flex-col bg-desk text-foreground">
            <Watches engine={engine} modules={modules} projects={open} />
            <Bar
              status={status}
              workspaces={barWorkspaces}
              map={
                <WorkspaceMap workspace={current(workspaces)} shows={shows} />
              }
              current={workspaces.current}
              sidebar={narrow ? over : sidebar}
              onSidebar={toggleSidebar}
              problems={bar.problems}
              widgets={bar.parts}
              listed={bar.listed}
              onArrange={arrangeBar}
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
                  onSnooze={(project, listed, anchor) =>
                    setSnoozing({
                      project,
                      listed,
                      ...(anchor ? { anchor } : {}),
                    })
                  }
                  onWake={wakeThread}
                  onAddProject={() => parts.run("project.add")}
                  onPin={(project, pinned) =>
                    updateProject(engine, { project, pinned }).catch(
                      (error: unknown) =>
                        console.error(
                          "banda: the Project was not pinned",
                          error
                        )
                    )
                  }
                  onProjectSettings={(project) =>
                    settings(`projects/${project}`)
                  }
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
                    projectOf={projectOf}
                    shows={shows}
                    marked={marked}
                    away={away}
                    zoomed={zoomed}
                    reveal={reveal}
                    inset={sidebarShown && !narrow ? sidebarWidth : 0}
                    frame={frame}
                    onStep={stepBy}
                    onGo={goTo}
                    onStart={startHere}
                  />
                )}
                {peek && (
                  <Peek
                    peek={peek}
                    engine={engine}
                    modules={modules}
                    run={parts.run}
                    open={(project, pane, place) =>
                      change((w) => opening(w, project, pane, { place }))
                    }
                    onUpdate={(pane) =>
                      setPeek((was) => was && { ...was, pane })
                    }
                    onOpen={() =>
                      parts.open(peek.pane, peek.project, {
                        again: false,
                        update: true,
                      })
                    }
                    onFill={fillPeek}
                    onClose={closePeek}
                  />
                )}
                <Toaster />
                <SnoozePicker
                  target={snoozing}
                  onClose={() => setSnoozing(undefined)}
                  onSnooze={(target, until) =>
                    snoozeThread(target.project, target.listed, until)
                  }
                  onWake={(target) =>
                    wakeThread(target.project, target.listed.id)
                  }
                />
                <QuitDialog
                  working={quitting}
                  onQuit={device.quit}
                  onClose={() => setQuitting(null)}
                />
                <BandaMenu
                  opening={menu}
                  onClose={closeMenu}
                  onChoose={choose}
                  onAdded={added}
                  engine={engine}
                  modules={modules}
                  project={here}
                  asleep={snoozes.asleep}
                  projects={menuProjects}
                  actions={keyed}
                  binds={binds}
                />
                {drawer && dropped && (
                  <Drawer
                    entry={drawer}
                    shown={drawerShown}
                    height={drawerLook.height}
                    engine={engine}
                    modules={modules}
                    shows={shows}
                    projectOf={projectOf}
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
                    projectOf={projectOf}
                    shows={shows}
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
        </ThreadMenus>
      </StoresContext.Provider>
    </KeysInForce.Provider>
  )
}
