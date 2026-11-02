import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Engine, SpaceId, SpaceSummary, Status } from "@banda/contract"
import { inFront, useInFront } from "@banda/ui/hooks/use-in-front"
import { useLive } from "@banda/ui/hooks/use-live"
import { useMachine } from "@banda/ui/hooks/use-status"
import { openSpaces, updateSpace } from "@banda/ui/lib/spaces"
import { IN_PROGRAM, type PaneState, QUIET } from "@banda/ui/pane"
import { DEFAULT_KEYS } from "@banda/contract/look"
import type { Action, WindowApi } from "@banda/ui/module"
import { actionFor, rebind } from "../actions/actions"
import { Bar } from "../bar/Bar"
import { type Lists, Watches } from "../bar/Watches"
import { isShowing, sightOf } from "../calls/sight"
import { SUMMARY } from "../calls/system"
import { Toasts } from "../calls/Toasts"
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
import { columnsOf, useLookKeys, useLookNotify, useLookSound } from "../look"
import { modules as known } from "../modules"
import { kindOf, runs, showsOf, startable, widthOf } from "../registry"
import { Sidebar } from "../sidebar/Sidebar"
import { pickPreset } from "../sidebar/settings"
import { toggleSettled } from "../sidebar/settled"
import type { Arranged } from "@banda/contract/workspaces"
import {
  arrangedSource,
  type Asked,
  NO_VIEW,
  resolve,
  send,
  tidied,
  type View,
  viewOf,
  withAsked,
} from "../workspaces/arrange"
import {
  current,
  type Entry,
  entries,
  focused,
  focusEntry,
  go,
  inBar,
  left,
  samePane,
  step,
  type Workspaces as State,
} from "../workspaces/model"
import { Overview } from "../workspaces/Overview"
import type { Frame } from "../workspaces/PaneFrame"
import {
  keepLooked,
  keepSidebar,
  keepView,
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
  const source = useMemo(
    () => (machine ? arrangedSource(engine) : null),
    [engine, machine]
  )
  const live = useLive(engine, machine ?? "", source)
  const ready = live.state === "ready"
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
  const [overview, setOverview] = useState(false)
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
  const calls = useCalls(useLookSound(), notify, where)
  const { hear, leave, calling, hold, dismiss, seen } = calls
  const listening = useMemo(() => ({ hear, leave }), [hear, leave])
  const front = useInFront()
  // What the Person looks at is seen: its toast and notification go.
  useEffect(() => {
    for (const call of calling)
      if (sightOf(workspaces, call, front, showsOf, columnsOf()) === "looking")
        seen(call.key)
  }, [calling, workspaces, front, seen])
  const toasts = calls.toasts
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
    for (const entry of left(before.current, workspaces)) {
      kindOf(entry.pane.kind)?.closed?.({
        engine,
        space: entry.space,
        args: entry.pane.args,
      })
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
  const answerCall = useCallback(
    (call: Heard) => {
      dismiss(call.key)
      change((w) => answering(w, call))
    },
    [change, dismiss]
  )
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
        if (key === SUMMARY) return setSidebar(true)
        const call = heard.current.find((c) => c.key === key)
        if (call) answerCall(call)
      }),
    [answerCall]
  )
  // `banda menu ROUTE` opens the menu there (ADR 0017, decision 7).
  const spacesNow = useRef(spaces)
  useEffect(() => {
    spacesNow.current = spaces
  }, [spaces])
  // Alt+S: the Thread in the focused Pane settles, or comes back.
  const listsNow = useRef(lists)
  useEffect(() => {
    listsNow.current = lists
  }, [lists])
  const settle = useCallback(() => {
    const entry = focused(seenNow.current.state)
    const thing = entry && showsOf(entry.pane)
    if (entry && thing) toggleSettled(listsNow.current, entry.space, thing)
  }, [])
  const toggleSidebar = useCallback(() => setSidebar((shows) => !shows), [])
  const toggleOverview = useCallback(() => setOverview((opens) => !opens), [])
  // The Pane zoomed over the whole window, while it keeps the focus: the
  // focus elsewhere, or the overview, brings it back (ADR 0025, decision 4).
  const [zoom, setZoom] = useState<string>()
  const zoomed =
    zoom !== undefined && !overview && focused(workspaces)?.id === zoom
      ? zoom
      : undefined
  if (zoom !== undefined && zoomed === undefined) setZoom(undefined)
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
  const closeOverview = useCallback(() => setOverview(false), [])
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
      open: (pane, space, how) =>
        change((w) =>
          opening(w, space ?? focused(w)?.space ?? home, pane, {
            ...how,
            place: "right",
            again: true,
          })
        ),
      toggleSidebar,
      toggleOverview,
      zoom: toggleZoom,
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
    toggleZoom,
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
      const inDialog = target?.closest("[role=dialog]") != null
      if (inDialog && !action.overDialogs) return
      // A terminal leaves alone a key that was taken.
      event.preventDefault()
      event.stopPropagation()
      action.run(parts)
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
    }),
    [change, update, parts]
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
    (id: SpaceId) => spaces.find((space) => space.id === id)?.name ?? "Space",
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
        sidebar={sidebar}
        onSidebar={toggleSidebar}
        problems={keyed.problems}
        onPick={(index) =>
          index === workspaces.current
            ? toggleOverview()
            : change((w) => go(w, index))
        }
      />
      <div
        className="relative flex min-h-0 flex-1"
        data-sidebar-shown={(sidebar && !zoomed) || undefined}
      >
        {sidebar && !zoomed && (
          <Sidebar
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
        <main className="relative min-h-0 min-w-0 flex-1">
          {ready && (
            <Workspaces
              workspaces={workspaces}
              covered={overview}
              engine={engine}
              modules={modules}
              spaceName={spaceName}
              called={called}
              marked={marked}
              zoomed={zoomed}
              center={center}
              listed={listed}
              frame={frame}
              onStep={(by) => change((w) => step(w, by))}
              onStart={(pane) => parts.open(pane)}
            />
          )}
          <Toasts
            toasts={toasts}
            calling={calling}
            detail={notify.detail}
            onAnswer={answerCall}
            onMore={() => setSidebar(true)}
            onHold={hold}
          />
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
            spaces={spaces}
            actions={keyed.actions}
            binds={inForce.binds}
          />
          {overview && (
            <Overview
              workspaces={workspaces}
              spaceName={spaceName}
              onFocus={(entry) => {
                change((w) => focusEntry(w, entry))
                closeOverview()
              }}
              onGo={(index) => {
                change((w) => go(w, index))
                closeOverview()
              }}
              onClose={closeOverview}
            />
          )}
        </main>
      </div>
    </div>
  )
}
