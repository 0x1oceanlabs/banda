import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { Toaster } from "@banda/ui/components/sonner"
import { inFront, useInFront } from "@banda/ui/hooks/use-in-front"
import { useMachine } from "@banda/ui/hooks/use-status"
import { openProjects } from "@banda/ui/lib/projects"
import {
  HostsContext,
  useEngineOf,
  usePaneOn,
  useStore,
} from "@banda/core/react"
import type { PaneState } from "@banda/ui/pane"
import { Bar } from "../bar/Bar"
import { tomlOf } from "@banda/contract/settings"
import { useWidgets } from "../bar/layout/Widgets"
import type { Layout } from "../bar/layout/arrange"
import { PARTS } from "../bar/layout/placed"
import { Watches } from "../calls/Watches"
import { quiet } from "../calls/quiet"
import { besideOf, callAfter, sightOf } from "../calls/sight"
import {
  followCalls,
  itemsOf,
  listedIn,
  newStores,
  nowOf,
  workingHere,
} from "../calls/stores"
import { useOrderNow } from "../sidebar/order"
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
import { writeLook } from "../menu/theme"
import { writeSidebar } from "../sidebar/write-setting"
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
  identityOf,
  keptAway,
  letGoWhenBack,
  runs,
  sheetsOf,
  showsOf,
  sources,
} from "../registry"
import { Edge } from "../sidebar/Edge"
import { Sidebar } from "../sidebar/Sidebar"
import { LaterPicker } from "../sidebar/LaterPicker"
import { RemovingProject } from "../settings/RemoveProject"
import { SaidRegion } from "../sidebar/SaidRegion"
import { QuitDialog } from "./Quit"
import { useWokeNote } from "../calls/woke"
import { paneRowsOf } from "../sidebar/items"
import { attachChips, focusedOn } from "./attach"
import { Kept, useKeptHere } from "./here"
import { tilingShows } from "./shows"
import { useNarrow } from "./narrow"
import { floorsOf, type Reveal, shownOf } from "../tiling/layout"
import { useTiling } from "../tiling/useTiling"
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
  left,
  projectIn,
  samePane,
  share,
  step,
  widthIn,
} from "../tiling/model"
import { targetsOf } from "../tiling/actions"
import { useFlowHere } from "../tiling/flow"
import { Drawer, useDrawer } from "./Drawer"
import { Peek, usePeek } from "./Peek"
import { Sheet, useSheet, useSheetTilesGo } from "./Sheet"
import { useMadeGoesHome } from "./made"
import { usePlacing, writeFlow } from "./placing"
import { Overview } from "../tiling/Overview"
import type { Frame } from "../tiling/PaneFrame"
import {
  keepLooked,
  keepSidebar,
  keepSidebarWidth,
  loadLooked,
  loadSidebar,
  loadSidebarWidth,
} from "../tiling/store"
import { Workspaces } from "../tiling/Workspaces"
import {
  closing,
  focusedIn,
  openingFrom,
  placed,
  startingHere,
  strayedIn,
} from "../tiling/opening"
import { runAction, type Shell as Parts, useWindowApi } from "./actions"
import { useAsked } from "./asked"
import { KeysInForce } from "@banda/ui/hooks/use-key-of"
import { ThreadMenus } from "../titles/ThreadMenu"
import { device } from "../boot"
import { useKeyRouter, useKeys } from "./keys"
import { useSteady } from "./steady"
import { closeTop, Layered, TopPart, useTopFollows, useTops } from "./top"

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
  modules,
  projects,
  home,
  onCreated,
}: {
  engine: Engine
  modules: readonly string[]
  projects: ProjectSummary[]
  /** The home Project, where a New Thread starts with no Pane on screen. */
  home: ProjectId
  onCreated: (project: ProjectSummary) => void
}) {
  // A Project whose folder is missing lists nothing and starts nothing
  // until the Person locates it (ADR 0026, decision 6).
  const open = useMemo(() => openProjects(projects), [projects])
  // The Tiling: the engine's arrangement, its view and its queue (ADR 0087).
  const machine = useMachine(engine)
  // Solo (ADR 0079, decision 2): every Agent's Group on a Project's
  // workspace is drawn the whole screen wide, and the Strip scrolls
  // from one to the next. `Alt+M` shows the workspace in view as the row
  // for a while (`row`), until it goes or the Flow changes. Both are this
  // device's view, and write nothing (ADR 0127, decision 3).
  const { flow, pick: pickFlow } = useFlowHere()
  const solo = flow === "solo"
  const [row, setRow] = useState<string>()
  const [stores] = useState(newStores)
  // Where the Panes go, and which emptied workspaces go (ADR 0102).
  const placingNow = usePlacing(stores, flow, projects, machine)
  const { placing, gone, strict, projectOf } = placingNow
  const tiling = useTiling({ engine, machine, modules, home, flow, row, gone })
  const { ready, aside, workspaces, standing, drawnNow, changing } = tiling
  const { change, update } = tiling
  const inView = current(workspaces).id
  // Gone from it, or out of solo, the row is over: as drawn, at once.
  if (row !== undefined && (!solo || row !== inView)) setRow(undefined)
  const glance = useCallback(() => {
    if (!solo) return false
    const id = current(drawnNow()).id
    setRow((was) => (was === id ? undefined : id))
    return true
  }, [solo, drawnNow])
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
  // Narrow, the window hides the sidebar and shows it over the Strip when
  // asked; wide, it keeps the Person's choice (ADR 0025, decision 10).
  const columnMin = useLookColumns().min
  const narrow = useNarrow(columnMin, sidebarWidth)
  const [over, setOver] = useState(false)
  if (over && !narrow) setOver(false)
  const setShown = narrow ? setOver : setSidebar
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
  // terminal stops its program; one moved, or drawn still, has not left.
  const engineOf = useEngineOf()
  const kept = useContext(HostsContext)
  const before = useRef(standing)
  useEffect(() => {
    for (const entry of left(before.current, standing, identityOf))
      closedOf(
        () => engineOf(entry.project, entry.pane),
        entry,
        keptAway(kept, entry)
      )
    before.current = standing
  }, [engineOf, kept, standing])
  useEffect(() => letGoWhenBack(kept), [kept])

  // What the Apps list and what calls the Person (`stores`), for the Marks,
  // the rings and Alt+U, kept outside React: a list that changes draws
  // again only what reads it (ADR 0088, decision 7). The notifications
  // module tells of what calls (ADR 0056, decision 1). Laters are read by a
  // clock that moves as the next one wakes (ADR 0074).
  useEffect(() => followCalls(stores), [stores])
  const laterClock = useStore(stores.calls, nowOf)
  const orderNow = useOrderNow()
  // What the Tiling reads of them, the same for the Window's life.
  const [shows] = useState(() => tilingShows(stores, showsOf))
  // Alt+C's column to the middle, and a Pane picked, from a row, a call
  // or Alt+U, to the left (ADR 0065, decision 8): once each.
  const [reveal, setReveal] = useState<Reveal>()
  // A Pane picked opens on the host its Project is on (ADR 0081).
  const paneOn = usePaneOn()
  // `banda menu ROUTE` opens the menu there (ADR 0017, decision 7).
  const projectsNow = useRef(projects)
  useEffect(() => {
    projectsNow.current = projects
  }, [projects])
  useMadeGoesHome(projects, placing, change)
  // How many Agents worked as the Person asked to quit, while Banda asks
  // whether to stop them (ADR 0086, decision 3).
  const [quitting, setQuitting] = useState<number | null>(null)
  const toggleOverview = useCallback(
    () => setOverview((was) => (was === "open" ? "closing" : "open")),
    []
  )
  // The drawer (ADR 0025, decision 8). Dropped with none, it gets a new
  // Thread in the home Project, the agents module's, which opens it there.
  const drawer = useDrawer()
  const drawerLook = useLookDrawer()
  const toggleDrawer = useCallback(
    (parts: Parts) =>
      drawer.toggle(() =>
        parts.run("thread.new", {
          project: home,
          place: "drawer",
          ...(drawerLook.harness && { harness: drawerLook.harness }),
        })
      ),
    [drawer, home, drawerLook.harness]
  )
  // Quick Look's tile over the desk (ADR 0073, decision 7).
  const { peek, setPeek, peekNow, closePeek, fillPeek } = usePeek()
  // The Pane zoomed over the whole window, while it keeps the focus: the
  // focus elsewhere, or the overview, brings it back (ADR 0025, decision 4).
  const [zoom, setZoom] = useState<string>()
  const zoomed =
    zoom !== undefined && !overview && focused(workspaces)?.id === zoom
      ? zoom
      : undefined
  if (zoom !== undefined && zoomed === undefined) setZoom(undefined)
  const sidebarShown = (narrow ? over : sidebar) && !zoomed
  // Where the Person is (ADR 0087, decision 4), and what the Apps list,
  // as the Apps' code reads them.
  const around = { sidebar: sidebarShown, home, machine, flow, projects }
  const here = useKeptHere(drawnNow, around, showsOf)
  const [items] = useState(() => itemsOf(stores))
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
  // started on an empty workspace opens in its Project, there or into
  // the Project's own Group (`startingHere`).
  const stepBy = useCallback(
    (by: 1 | -1) => change((w) => step(w, by)),
    [change]
  )
  const startHere = useCallback(
    (pane: PaneState) => change((w) => startingHere(w, home, pane, placing)),
    [change, home, placing]
  )
  // Alt+Space or Alt+K again, or the other of them, closes the menu.
  const toggleMenu = useCallback(
    (at: At) => setMenu((open) => (open ? null : openingAt(at))),
    []
  )
  const closeMenu = useCallback(() => setMenu(null), [])

  // The actions with the keys in force (keys.ts).
  const { mod, binds, keyed, keys, own } = useKeys()
  // The Sheet (ADR 0102, decision 5), in the Project the Person is in.
  const sheet = useSheet(() => projectIn(drawnNow()) ?? home)
  const { settings } = sheet
  useSheetTilesGo(ready, drawnNow, change)
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
    const working = workingHere(stores)
    if (working === 0) device.quit()
    else setQuitting(working)
  }, [stores])

  // The action context (ADR 0088, decision 7): made afresh with each
  // drawing, and held steady, so the keys' listener, the Tiles' frame and
  // the widgets that hold it are never made again.
  const parts = useSteady<Parts>({
    change,
    home,
    open: (
      pane,
      project,
      { beside, again = true, update, toggle, drawer: inDrawer, ...how } = {}
    ) => {
      if (inDrawer) return drawer.into(pane, project ?? home)
      if (sheetsOf(pane)) return sheet.show(pane, project, { toggle, again })
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
        const into = project ?? at?.project ?? projectIn(w) ?? home
        // Toggled, the one in focus closes when it is this one.
        const entry = toggle && focused(w)
        if (entry && samePane(entry, { project: into, pane }, identityOf))
          return closing(entry.id)
        // Not again: the one shown, as its kind names it, keeps what it
        // shows, or takes these args when asked to update it. Beside its
        // Agent's Thread, where a workspace shows it, in its Group; else
        // where the engine places what is opened for an Agent.
        return placed(w, into, pane, placing, {
          ...how,
          ...(at &&
            (at.from ? { from: at.from, place: "group" } : { agents: true })),
          ...(again ? { again } : update && { update }),
        })
      })
    },
    here,
    beside: (agent) => {
      const at = besideOf(drawnNow(), stores.items.get(), agent, showsOf)
      return at && { project: at.project, right: at.from ? at.right : null }
    },
    items,
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
    // The one answer to `pane.pick` (ADR 0087, decision 7): the Tiling
    // goes to the Pane, or opens it, and it comes to the left once drawn.
    reach: (how) =>
      void changing(how).then((entry) => {
        if (entry) setReveal({ entry, how: "left" })
      }),
    drawn: drawnNow,
    paneOn,
    // The Sheet, by the Top layer's one stack (ADR 0110, step 3).
    uncover: () => closeTop("sheet"),
    look: () => told,
    quiet: quiet.on,
    projects: () => open,
    projectOf,
    placing: () => placing,
    toggleSidebar: () => setShown((shows) => !shows),
    showSidebar,
    toggleOverview,
    drawer: () => toggleDrawer(parts),
    zoom: toggleZoom,
    popOut: togglePopOut,
    center: toCenter,
    // Alt+U: the next call below the Thread in front, as the sidebar lists
    // them, another machine's among this one's (ADR 0079, decision 4), picked.
    answer: () => {
      const calls = stores.calls.get()
      const { keys } = orderNow(stores.items.get(), projects, calls.now)
      const call = callAfter(calls.list, keys, here.get().pane)
      if (call)
        parts.run("pane.pick", { project: call.project, pane: call.pane })
    },
    menu: toggleMenu,
    fillPeek,
    glance,
    pickFlow: (to) => writeFlow(device.settings.set, pickFlow(to)),
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
    run: (action, args) => void runAction(parts, action, args),
    engine,
    hosts: kept,
    ...useTops(kept),
    sessionOf: engineOf,
    waiting: kept.waiting,
    writeSetting: device.settings.set,
    attach: (chips) =>
      attachChips(chips, focused(drawnNow()), kept, (entry) =>
        change((w) => focusEntry(w, entry))
      ),
  })
  // A Thread that woke by itself is told of once (ADR 0074, decision 7).
  useWokeNote(stores, parts.run)
  // A new Problem of Banda's own tells too, silently (ADR 0039).
  useProblemNews(engine, notify, parts.run)
  const api = useWindowApi(parts)
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
  // The keys run the actions, before any Pane hears them (keys.ts); an
  // Esc none kept, the Top layer's stack hears last (top/stack.ts).
  useKeyRouter(parts, keyed, mod)
  useTopFollows()
  // Pinned, the drawer's Thread is a column where the Flow says.
  const pinDrawer = useCallback(() => {
    const entry = drawer.take()
    if (entry) change((w) => placed(w, entry.project, entry.pane, placing))
  }, [drawer, change, placing])
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
  // The bar's widgets, the window's own and the modules', where the
  // look's `[bar]` puts them (ADR 0024). Where the Person is they read
  // from Here, so a move of the focus draws only those it concerns.
  const bar = useWidgets(modules, { engine, projects })
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
          // A pick goes as the sidebar's does, and so does one brought
          // beside, as its Shift+Enter.
          return parts.run(row.beside ? "pane.beside" : "pane.pick", {
            project: row.project,
            pane: row.listed.pane,
          })
        case "action":
          return runAction(parts, row.action)
        case "ask":
          return newThreadIn(
            row.project ?? here.get().starts,
            row.words || undefined
          )
        case "item":
          return parts.run(row.action, {
            project: row.project,
            item: row.listed.id,
          })
        case "group":
          return writeSidebar(parts.writeSetting, "group", row.group)
        case "look":
          return writeLook(parts.writeSetting, row)
        case "found":
          return row.row.run(parts)
      }
    },
    [newThreadIn, parts, here]
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
      // A Pane that comes as the Sheet comes so, asked for from a tile too.
      open: (project, pane, ...asked) =>
        sheetsOf(pane)
          ? parts.open(pane, project)
          : change((w) =>
              openingFrom(w, project, pane, parts.placing(), ...asked)
            ),
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
        const floor = floorsOf(workspace.id, look)
        const shown = column.entries[spot.entry]
        const listed = shown && listedIn(stores.items.get(), shown, showsOf)
        return {
          width: share(widthIn(workspace, column, look, floor)) ?? 0.5,
          full: column.full === true,
          deck: displayOf(column, look) === "deck",
          panes: column.entries.length,
          height: heightsOf(column)[spot.entry] ?? 1,
          left: spot.column > 0,
          right: spot.column < workspace.columns.length - 1,
          workspace: spot.workspace + 1,
          targets: targetsOf(state, spot, parts.projectOf),
          away: awayNow.current.has(entry),
          presets: look.presets,
          heights: look.heights,
          floor: floor?.(column) ?? 0,
          // What its Item's item actions offer here (ADR 0087, decision 12).
          items: listed
            ? paneRowsOf(listed, shown.project, parts.projects())
            : [],
        }
      },
    }),
    [change, update, parts, popOut, stores, drawnNow]
  )
  // What is asked from outside the window, it does, as for its own.
  useAsked(parts, frame.open)
  return (
    <KeysInForce.Provider value={keys}>
      <Kept
        stores={stores}
        here={here}
        tiled={{ store: tiling.store, aside, flow }}
        run={parts.run}
      >
        <ThreadMenus engine={engine} projects={projects}>
          <TopPart shell={parts} />
          <div className="flex h-svh flex-col bg-desk text-foreground">
            <Watches engine={engine} modules={modules} projects={open} />
            <Bar
              engine={engine}
              widgets={bar.parts}
              listed={bar.listed}
              onArrange={arrangeBar}
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
                  hiding={hiding}
                  projects={projects}
                  strayed={strayedIn(workspaces, placing)}
                  isCurrent={focusedIn(workspaces)}
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
                    covered={overview || drawer.shown}
                    overview={overview}
                    modules={modules}
                    projectOf={projectOf}
                    strict={strict}
                    gone={gone}
                    shows={shows}
                    marked={marked}
                    away={away}
                    zoomed={zoomed}
                    reveal={reveal}
                    inset={sidebarShown && !narrow ? sidebarWidth : 0}
                    narrow={narrow}
                    frame={frame}
                    onStep={stepBy}
                    onGo={goTo}
                    onStart={startHere}
                  />
                )}
                <Toaster />
                <SaidRegion />
                <LaterPicker />
                <RemovingProject engine={engine} />
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
                  laterClock={laterClock}
                  projects={menuProjects}
                  actions={keyed}
                  binds={binds}
                />
                {/* Each on its layer, in the layers' order (`top/layers.ts`). */}
                <Layered
                  parts={{
                    peek: peek && (
                      <Peek
                        peek={peek}
                        shell={parts}
                        onUpdate={(pane) =>
                          setPeek((was) => was && { ...was, pane })
                        }
                        onFill={fillPeek}
                        onClose={closePeek}
                      />
                    ),
                    drawer: drawer.drawn && (
                      <Drawer
                        entry={drawer.drawn}
                        shown={drawer.shown}
                        height={drawerLook.height}
                        modules={modules}
                        shows={shows}
                        projectOf={projectOf}
                        frame={frame}
                        onLift={drawer.lift}
                        onPin={pinDrawer}
                        onChange={drawer.change}
                        onClose={drawer.close}
                      />
                    ),
                    sheet: <Sheet state={sheet} shell={parts} />,
                  }}
                />
                {overview && (
                  <Overview
                    open={overviewState === "open"}
                    onExited={leftOverview}
                    workspaces={workspaces}
                    projectOf={projectOf}
                    strict={strict}
                    gone={gone}
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
      </Kept>
    </KeysInForce.Provider>
  )
}
