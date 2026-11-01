import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Engine, SpaceId, SpaceSummary, Status } from "@bandaso/contract"
import { QUIET } from "@bandaso/ui/pane"
import { DEFAULT_SOUND } from "@bandaso/ui/sound"
import { actionFor } from "../actions/actions"
import { Bar } from "../bar/Bar"
import { Watches } from "../bar/Watches"
import { useCalls } from "../calls/useCalls"
import { kindOf, startable, widthOf } from "../registry"
import { Sidebar } from "../sidebar/Sidebar"
import {
  close,
  focusEntry,
  go,
  left,
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
import { ACTIONS, newThread, opening, type Shell as Parts } from "./actions"

type Change = (workspaces: State) => State

/**
 * The window (ADR 0005): the bar on top, the sidebar docked on the left,
 * and the workspaces, or the overview of them all. It holds what they
 * share, the workspaces, which parts show and what the modules call the
 * Person for, plays their calls, and runs the actions that change them.
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
  const [attention, setAttention] = useState(QUIET)
  // The look will bring the Person's own `[sound]` (ADR 0009, decision 5).
  const call = useCalls(DEFAULT_SOUND)
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
  const toggleSidebar = useCallback(() => setSidebar((shows) => !shows), [])
  const toggleOverview = useCallback(() => setOverview((opens) => !opens), [])
  const closeOverview = useCallback(() => setOverview(false), [])

  // The keys run the actions, before any Pane hears them.
  useEffect(() => {
    const parts: Parts = { change, home, toggleSidebar, toggleOverview }
    const onKey = (event: KeyboardEvent) => {
      const action = actionFor(ACTIONS, event)
      if (!action) return
      // A terminal leaves alone a key that was taken.
      event.preventDefault()
      event.stopPropagation()
      action.run(parts)
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [change, home, toggleSidebar, toggleOverview])

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
        onCall={call}
      />
      <Bar
        status={status}
        attention={attention}
        numbers={shown(workspaces)}
        current={workspaces.current}
        sidebar={sidebar}
        onSidebar={toggleSidebar}
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
            modules={modules}
            spaces={spaces}
            onOpen={(space, pane) =>
              change((w) => opening(w, space, pane, undefined, "right"))
            }
            onNewThread={(space) => change((w) => newThread(w, space))}
            onCreated={(space) => {
              onCreated(space)
              change((w) => newThread(w, space.id))
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
            frame={frame}
            onStep={(by) => change((w) => step(w, by))}
            onStart={(pane) => change((w) => opening(w, home, pane))}
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
