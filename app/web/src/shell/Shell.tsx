import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  type Engine,
  newId,
  type SpaceId,
  type SpaceSummary,
  type Status,
} from "@banda/contract"
import { works } from "@banda/ui/components/banda-mark"
import { Toaster } from "@banda/ui/components/sonner"
import { inFront, useInFront } from "@banda/ui/hooks/use-in-front"
import { useMachine } from "@banda/ui/hooks/use-status"
import { openSpaces, updateSpace } from "@banda/ui/lib/spaces"
import { IN_PROGRAM, type Lists, type PaneState, QUIET } from "@banda/ui/pane"
import { DEFAULT_KEYS } from "@banda/contract/look"
import type { Action, WindowApi } from "@banda/ui/module"
import { actionFor, rebind } from "../actions/actions"
import { Bar } from "../bar/Bar"
import { useWidgets } from "../bar/Widgets"
import { Watches } from "../bar/Watches"
import { besideOf, isShowing, sightOf } from "../calls/sight"
import { SUMMARY } from "../calls/system"
import { WELL, wentWell } from "../safe/starts"
import { problemLink } from "../problems/live"
import { NOTICE, useProblemNews } from "../problems/news"
import type { ProblemAnswers } from "../problems/problemToast"
import { lookingInto } from "../problems/look"
import { first, type Heard, useCalls, type Where } from "../calls/useCalls"
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
  identityOf,
  runs,
  showsOf,
  startable,
  widthOf,
} from "../registry"
import { Sidebar } from "../sidebar/Sidebar"
import { pickPreset } from "../sidebar/settings"
import { toggleSettled } from "../sidebar/settled"
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
import { useArranged } from "../workspaces/useArranged"
import {
  current,
  type Entry,
  entries,
  focused,
  across,
  focusEntry,
  go,
  inBar,
  left,
  samePane,
  step,
  type Workspaces as State,
} from "../workspaces/model"
import { Drawer } from "../workspaces/Drawer"
import { Overview } from "../workspaces/Overview"
import type { Frame } from "../workspaces/PaneFrame"
import {
  keepDrawer,
  keepLooked,
  keepSidebar,
  keepView,
  loadDrawer,
  loadLooked,
  loadSidebar,
  loadView,
  moveOver,
} from "../workspaces/store"
import { Workspaces } from "../workspaces/Workspaces"
import {
  ACTIONS,
  answering,
  bringing,
  closing,
  opening,
  runAction,
  settingsAt,
  type Shell as Parts,
  type Step,
} from "./actions"

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
  spaces,
  home,
  onCreated,
}: {
  engine: Engine
  status: Status
  modules: readonly string[]
  spaces: SpaceSummary[]
  /** The Space a new Thread starts in. */
  home: SpaceId
  onCreated: (space: SpaceSummary) => void
}) {
  // A Space whose folder is missing lists nothing and starts nothing
  // until the Person locates it (ADR 0026, decision 6).
  const open = useMemo(() => openSpaces(spaces), [spaces])
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
  // A narrow window hides the sidebar, and shows it over the Strip only
  // when asked; what the Person chose for a wide one is kept (ADR 0025,
  // decision 10).
  const narrow = useNarrow(useLookColumns().min)
  const [over, setOver] = useState(false)
  if (over && !narrow) setOver(false)
  const setShown = narrow ? setOver : setSidebar
  const toggleSidebar = useCallback(
    () => setShown((shows) => !shows),
    [setShown]
  )
  const showSidebar = useCallback(() => setShown(true), [setShown])
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
  // What calls the Person, told where they look as `[notify]` says
  // (ADR 0011), with their `[sound]` (ADR 0009, decision 5).
  const where: Where = useMemo(
    () => ({
      sight: (call) =>
        sightOf(seenNow.current.state, call, inFront(), showsOf, columnsOf()),
      desktop: window.banda?.notify,
    }),
    []
  )
  const notify = useLookNotify()
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
  const change = useCallback(
    (how: Change) => {
      const run = async () => {
        const was = seenNow.current.state
        const next = how(was)
        if (!next || next === was) return
        if (!("command" in next)) {
          // The view alone: drawn as `next` at once.
          seenNow.current = looking(seenNow.current, viewOf(next))
          return setView(() => viewOf(next))
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
      }
      changes.current = changes.current.then(run).catch(refused)
      return changes.current
    },
    [engine, setView, drawnWhen, answeredAt]
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
  // Answered, the call is seen, and its toast and notification go.
  const answerCall = useCallback(
    (call: Heard) => change((w) => answering(w, call)),
    [change]
  )
  const { hear, leave, calling, seen } = useCalls(
    useLookSound(),
    notify,
    where,
    answerCall
  )
  const listening = useMemo(() => ({ hear, leave }), [hear, leave])
  // What the Person looks at is seen: its toast and notification go.
  useEffect(() => {
    for (const call of calling)
      if (sightOf(workspaces, call, front, showsOf, columnsOf()) === "looking")
        seen(call.key)
  }, [calling, workspaces, front, seen])
  const heard = useRef(calling)
  useEffect(() => {
    heard.current = calling
  }, [calling])
  const answer = useCallback(() => {
    const call = first(heard.current)
    if (call) answerCall(call)
  }, [answerCall])
  // A click on a notice brings the window to the front and goes there;
  // the notice of many shows the sidebar, which lists them all.
  useEffect(
    () =>
      window.banda?.notify.listen((key) => {
        if (key === SUMMARY) return showSidebar()
        const call = heard.current.find((c) => c.key === key)
        if (call) answerCall(call)
      }),
    [answerCall, showSidebar]
  )
  // `banda menu ROUTE` opens the menu there (ADR 0017, decision 7).
  const spacesNow = useRef(spaces)
  useEffect(() => {
    spacesNow.current = spaces
  }, [spaces])
  // Alt+S: the Thread in the focused Pane settles, or comes back.
  const listsNow = useRef(lists)
  // Who hears the lists change: a module, as the browser for its tabs.
  const listsHeard = useRef(new Set<() => void>())
  useEffect(() => {
    listsNow.current = lists
    for (const listener of listsHeard.current) listener()
  }, [lists])
  const settle = useCallback(() => {
    const entry = focused(seenNow.current.state)
    const thing = entry && showsOf(entry.pane)
    if (entry && thing) toggleSettled(listsNow.current, entry.space, thing)
  }, [])
  const toggleOverview = useCallback(
    () => setOverview((was) => (was === "open" ? "closing" : "open")),
    []
  )
  // The drawer (ADR 0025, decision 8): its Pane, kept between runs, and
  // whether it shows. Dropped with none, it gets a new Thread in the home
  // Space, the agents module's, caught before a workspace opens it.
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
          open: (pane, space) => {
            const entry = { id: newId(), space: space ?? home, pane }
            drawerNow.current = entry
            setDrawer(entry)
          },
        }
        runAction(catching, "thread.new", {
          space: home,
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
  const [center, setCenter] = useState(0)
  const toCenter = useCallback(() => setCenter((n) => n + 1), [])
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
  const said = JSON.stringify(lookKeys.binds)
  const [shipped, setShipped] = useState<string>()
  const inForce = shipped === said ? DEFAULT_KEYS : lookKeys
  const keyed = useMemo(() => rebind(ACTIONS, inForce), [inForce])
  const saidNow = useRef(said)
  useEffect(() => {
    saidNow.current = said
  }, [said])
  // The settings Pane (ADR 0016), in the focused Pane's Space.
  const settings = useCallback(
    (link?: string) =>
      change((w) => settingsAt(w, focused(w)?.space ?? home, link)),
    [change, home]
  )
  // A click on a Problem's notice opens it in Settings → Problems.
  useEffect(
    () =>
      window.banda?.notify.listen((key) => {
        if (key.startsWith(NOTICE))
          settings(problemLink(key.slice(NOTICE.length)))
      }),
    [settings]
  )
  // A settings route opens the settings there; any other, the menu.
  const route = useCallback(
    (route: string) => {
      const link = settingsLinkOf(route)
      if (link === undefined) setMenu(openingOf(route, spacesNow.current))
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
      open: (pane, space, { beside, again = true, ...how } = {}) =>
        change((w) => {
          const at = beside
            ? besideOf(w, listsNow.current, beside, showsOf)
            : null
          return opening(
            w,
            space ?? at?.space ?? focused(w)?.space ?? home,
            pane,
            {
              ...how,
              ...(at?.from ? { from: at.from } : {}),
              place: "right",
              ...(again && { again }),
            }
          )
        }),
      focused: () => {
        const entry = focused(seenNow.current.state)
        return entry ? { space: entry.space, pane: entry.pane } : null
      },
      beside: (agent) => {
        const at = besideOf(
          seenNow.current.state,
          listsNow.current,
          agent,
          showsOf
        )
        return at && { space: at.space, right: at.from ? at.right : null }
      },
      lists: () => listsNow.current,
      watchLists: (listener) => {
        listsHeard.current.add(listener)
        return () => listsHeard.current.delete(listener)
      },
      toggleSidebar,
      toggleOverview,
      drawer: () => toggleDrawer(parts),
      zoom: toggleZoom,
      popOut: togglePopOut,
      center: toCenter,
      answer,
      settle,
      menu: toggleMenu,
      route,
      ownKeys,
      settings,
      run: (action, args) => runAction(parts, action, args),
    }
    return parts
  }, [
    change,
    home,
    toggleSidebar,
    toggleOverview,
    toggleDrawer,
    toggleZoom,
    togglePopOut,
    toCenter,
    answer,
    settle,
    toggleMenu,
    route,
    ownKeys,
    settings,
  ])
  // Each module that runs starts once, with the window as it is when it
  // asks (ADR 0022): the browser opens a Pane for an Agent's tab.
  const partsNow = useRef(parts)
  useEffect(() => {
    partsNow.current = parts
  }, [parts])
  // A new Problem of Banda's own tells too, silently (ADR 0039).
  const problemAnswers: ProblemAnswers = useMemo(
    () => ({
      lookInto: (problem) =>
        void lookingInto(engine, problem.fingerprint)
          .then((thread) => partsNow.current.run("thread.new", thread))
          .catch(() => undefined),
      details: (problem) => settings(problemLink(problem.fingerprint)),
    }),
    [engine, settings]
  )
  useProblemNews(engine, notify, inFront, where.desktop, problemAnswers)
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
  // shows it or in a new column; a Space gets a new Thread.
  const openPane = useCallback(
    (space: SpaceId, pane: PaneState) =>
      change((w) => opening(w, space, pane, { place: "right" })),
    [change]
  )
  // Pinned, the drawer's Thread is a column of the workspace on screen.
  const pinDrawer = useCallback(() => {
    const entry = drawerNow.current
    closeDrawer()
    if (entry) openPane(entry.space, entry.pane)
  }, [closeDrawer, openPane])
  // A new Thread is the agents module's, as its key's (`thread.new`).
  const startThread = useCallback(
    (space: SpaceId, ask?: string) =>
      parts.run("thread.new", { space, ...(ask && { ask }) }),
    [parts]
  )
  // A Space whose folder is missing finds it first (ADR 0026).
  const newThreadIn = useCallback(
    (space: SpaceId, ask?: string) =>
      spacesNow.current.find((one) => one.id === space)?.missing
        ? route(locateRoute(space))
        : startThread(space, ask),
    [startThread, route]
  )
  // The Space the focused Pane is in: where the menu's New Thread starts.
  const here = focused(workspaces)?.space ?? home
  // The bar's widgets, the window's own and the modules', where the
  // look's `[bar]` puts them (ADR 0024).
  const bar = useWidgets(modules, {
    engine,
    spaces,
    space: here,
    window: parts,
    lists,
    sidebarShown,
    onOpen: openPane,
    aside: (ready && live.view.aside) || null,
  })
  const choose = useCallback(
    (row: Exclude<Choice, Branch | Own>) => {
      switch (row.kind) {
        case "thread":
          return row.beside
            ? change((w) => bringing(w, row.space, row.listed.pane))
            : openPane(row.space, row.listed.pane)
        case "action":
          return row.action.run(parts)
        case "ask":
          return newThreadIn(row.space ?? here, row.words || undefined)
        case "settle":
          return toggleSettled(listsNow.current, row.space, row.listed.id)
        case "preset":
          return pickPreset(row.name)
        case "found":
          return row.row.run(parts)
      }
    },
    [change, openPane, newThreadIn, parts, here]
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
      open: (space, pane, from, place) =>
        change((w) => opening(w, space, pane, { from, place })),
      update,
      close: (entry) => change(() => closing(entry)),
      run: parts.run,
      arrange: (plan) => change(() => plan),
      popOut,
    }),
    [change, update, parts, popOut]
  )
  // What a Pane in its own window asks, the window does, as for its own.
  useEffect(
    () =>
      window.banda?.popped.asked((asked) => {
        if ("open" in asked) {
          const { space, pane, from, place } = asked.open
          frame.open(space, pane, from, place)
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
  const listed = useCallback(
    (entry: Entry) => {
      const thing = showsOf(entry.pane)
      return thing
        ? lists[entry.space]?.find((row) => row.id === thing)
        : undefined
    },
    [lists]
  )
  const spaceName = useCallback(
    (id: SpaceId) =>
      spaces.find((space) => space.id === id)?.name || "No Space",
    [spaces]
  )

  return (
    <div className="flex h-svh flex-col bg-desk text-foreground">
      <Watches
        engine={engine}
        modules={modules}
        spaces={open}
        onChange={setAttention}
        onLists={setLists}
        listening={listening}
      />
      <Bar
        status={status}
        attention={attention}
        workspaces={inBar(workspaces)}
        current={workspaces.current}
        sidebar={narrow ? over : sidebar}
        onSidebar={toggleSidebar}
        problems={[...keyed.problems, ...bar.problems]}
        widgets={bar.parts}
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
            over={narrow}
            onDismiss={narrow ? hideOver : undefined}
            onMenu={() => setMenu(openingAt("root"))}
            onSettings={() => settings()}
            spaces={spaces}
            lists={lists}
            home={home}
            isCurrent={(space, pane) => {
              const entry = focused(workspaces)
              return entry !== undefined && samePane(entry, { space, pane })
            }}
            onOpen={openPane}
            onNewThread={newThreadIn}
            onNoSpace={() => machine && startThread(machine)}
            onAddSpace={() => parts.run("space.add")}
            onPin={(space, pinned) =>
              updateSpace(engine, { space, pinned }).catch((error: unknown) =>
                console.error("banda: the Space was not pinned", error)
              )
            }
            onSpaceSettings={(space) => settings(`spaces/${space}`)}
            onLocate={(space) => route(locateRoute(space))}
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
              spaceName={spaceName}
              called={called}
              marked={marked}
              away={away}
              zoomed={zoomed}
              center={center}
              listed={listed}
              frame={frame}
              onStep={(by) => change((w) => step(w, by))}
              onGo={goTo}
              onStart={(pane) => parts.open(pane)}
            />
          )}
          <Toaster />
          <BandaMenu
            opening={menu}
            onClose={closeMenu}
            onChoose={choose}
            onAdded={(space) => {
              // As the engine answered it: the list may not know it yet.
              onCreated(space)
              startThread(space.id)
            }}
            engine={engine}
            modules={modules}
            space={here}
            lists={lists}
            spaces={spaces.filter((space) => !space.scratch)}
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
              spaceName={spaceName}
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
              spaceName={spaceName}
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
  )
}
