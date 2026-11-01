import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Engine, SpaceId, SpaceSummary, Status } from "@banda/contract"
import { inFront, useInFront } from "@banda/ui/hooks/use-in-front"
import { type PaneState, QUIET } from "@banda/ui/pane"
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
  type Keying,
  type Opening,
  openingAt,
  openingOf,
} from "../menu/menu"
import { columnsOf, useLookKeys, useLookNotify, useLookSound } from "../look"
import { kindOf, showsOf, startable, widthOf } from "../registry"
import { Sidebar } from "../sidebar/Sidebar"
import { pickPreset } from "../sidebar/settings"
import { toggleSettled } from "../sidebar/settled"
import {
  close,
  type Entry,
  focused,
  focusEntry,
  go,
  left,
  samePane,
  shown,
  step,
  update,
  type Workspaces as State,
} from "../workspaces/model"
import { Overview } from "../workspaces/Overview"
import type { Frame } from "../workspaces/PaneFrame"
import {
  keepSidebar,
  keepWorkspaces,
  loadSidebar,
  loadWorkspaces,
} from "../workspaces/store"
import { Workspaces } from "../workspaces/Workspaces"
import {
  ACTIONS,
  answering,
  bringing,
  newThread,
  opening,
  type Shell as Parts,
} from "./actions"

type Change = (workspaces: State) => State

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
  const [workspaces, setWorkspaces] = useState(() => {
    const first = startable(modules)[0]
    return loadWorkspaces(home, first && { pane: first, width: widthOf(first) })
  })
  const [sidebar, setSidebar] = useState(loadSidebar)
  const [overview, setOverview] = useState(false)
  const [menu, setMenu] = useState<Opening | null>(null)
  const [attention, setAttention] = useState(QUIET)
  const [lists, setLists] = useState<Lists>({})

  // What calls the Person, told where they look as `[notify]` says
  // (ADR 0011), with their `[sound]` (ADR 0009, decision 5).
  const now = useRef(workspaces)
  useEffect(() => {
    now.current = workspaces
  }, [workspaces])
  const where: Where = useMemo(
    () => ({
      sight: (call) =>
        sightOf(now.current, call, inFront(), showsOf, columnsOf()),
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
  useEffect(() => keepWorkspaces(workspaces), [workspaces])
  useEffect(() => keepSidebar(sidebar), [sidebar])

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

  const change = useCallback((how: Change) => setWorkspaces(how), [])
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
  useEffect(
    () =>
      window.banda?.menu.listen((route) =>
        setMenu(openingOf(route, spacesNow.current))
      ),
    []
  )
  // Alt+S: the Thread in the focused Pane settles, or comes back.
  const listsNow = useRef(lists)
  useEffect(() => {
    listsNow.current = lists
  }, [lists])
  const settle = useCallback(() => {
    const entry = focused(now.current)
    const thing = entry && showsOf(entry.pane)
    if (entry && thing) toggleSettled(listsNow.current, entry.space, thing)
  }, [])
  const toggleSidebar = useCallback(() => setSidebar((shows) => !shows), [])
  const toggleOverview = useCallback(() => setOverview((opens) => !opens), [])
  const closeOverview = useCallback(() => setOverview(false), [])
  // Alt+Space or Alt+K again, or the other of them, closes the menu.
  const toggleMenu = useCallback(
    (at: At) => setMenu((open) => (open ? null : openingAt(at))),
    []
  )
  const closeMenu = useCallback(() => setMenu(null), [])

  const parts: Parts = useMemo(
    () => ({
      change,
      home,
      toggleSidebar,
      toggleOverview,
      answer,
      settle,
      menu: toggleMenu,
    }),
    [change, home, toggleSidebar, toggleOverview, answer, settle, toggleMenu]
  )
  // The actions, with the Person's keys over their own (keys.toml).
  const lookKeys = useLookKeys()
  const keyed = useMemo(() => rebind(ACTIONS, lookKeys), [lookKeys])
  // The keys run the actions, before any Pane hears them. A dialog keeps
  // its keys, as the Banda menu its Alt+Enter, but for the menu's own.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = actionFor(keyed.actions, event)
      if (!action) return
      const target = event.target instanceof Element ? event.target : null
      // A field that takes a key to bind takes every key.
      if (target?.closest("[data-takes-keys]")) return
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
      change((w) => opening(w, space, pane, undefined, "right")),
    [change]
  )
  const newThreadIn = useCallback(
    (space: SpaceId, ask?: string, harness?: string) =>
      change((w) => newThread(w, space, ask, harness)),
    [change]
  )
  // The Space the focused Pane is in: where the menu's New Thread starts.
  const here = focused(workspaces)?.space ?? home
  const choose = useCallback(
    (row: Exclude<Choice, Branch | Keying>) => {
      switch (row.kind) {
        case "thread":
          return row.beside
            ? change((w) => bringing(w, row.space, row.listed.pane))
            : openPane(row.space, row.listed.pane)
        case "action":
          return row.action.run(parts)
        case "ask":
          return newThreadIn(
            row.space ?? here,
            row.words || undefined,
            row.harness
          )
        case "settle":
          return toggleSettled(listsNow.current, row.space, row.listed.id)
        case "preset":
          return pickPreset(row.name)
        case "file":
        case "web":
          return openPane(row.kind === "file" ? row.space : here, row.pane)
        case "copy":
          return void navigator.clipboard
            .writeText(row.text)
            .catch((error: unknown) => console.error("copy:", error))
      }
    },
    [change, openPane, newThreadIn, parts, here]
  )

  const frame: Frame = useMemo(
    () => ({
      focus: (entry) => change((w) => focusEntry(w, entry)),
      open: (space, pane, from, place) =>
        change((w) => opening(w, space, pane, from, place)),
      update: (entry, pane) => change((w) => update(w, entry, pane)),
      close: (entry) => change((w) => close(w, entry)),
    }),
    [change]
  )
  const called = useCallback(
    (entry: Entry) =>
      calling.find((call) => isShowing(entry, call, showsOf))?.chime,
    [calling]
  )
  const spaceName = useCallback(
    (id: SpaceId) => spaces.find((space) => space.id === id)?.name ?? "Space",
    [spaces]
  )

  return (
    <div className="flex h-svh flex-col bg-muted/40 text-foreground">
      <Watches
        engine={engine}
        modules={modules}
        spaces={spaces}
        onChange={setAttention}
        onLists={setLists}
        listening={listening}
      />
      <Bar
        status={status}
        attention={attention}
        numbers={shown(workspaces)}
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
      <div className="flex min-h-0 flex-1">
        {sidebar && (
          <Sidebar
            engine={engine}
            onMenu={() => setMenu(openingAt("root"))}
            spaces={spaces}
            lists={lists}
            home={home}
            isCurrent={(space, pane) => {
              const entry = focused(workspaces)
              return entry !== undefined && samePane(entry, { space, pane })
            }}
            onOpen={openPane}
            onNewThread={newThreadIn}
            onCreated={(space) => {
              onCreated(space)
              newThreadIn(space.id)
            }}
          />
        )}
        <main className="relative min-h-0 min-w-0 flex-1">
          <Workspaces
            workspaces={workspaces}
            covered={overview}
            engine={engine}
            modules={modules}
            spaceName={spaceName}
            called={called}
            frame={frame}
            onStep={(by) => change((w) => step(w, by))}
            onStart={(pane) => change((w) => opening(w, home, pane))}
          />
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
            engine={engine}
            space={here}
            lists={lists}
            spaces={spaces}
            actions={keyed.actions}
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
