import {
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { type Engine, newId, type ProjectId } from "@banda/contract"
import { type Flow, type Tiling, TILING_FILE } from "@banda/contract/workspaces"
import { type Readable, Store, useStore } from "@banda/core/react"
import { useInFront } from "@banda/ui/hooks/use-in-front"
import { fileNow, useFile } from "@banda/ui/lib/look"
import type { PaneState } from "@banda/ui/pane"
import {
  groupedOf,
  HOME_KINDS,
  LEAD_KINDS,
  NARROW_KINDS,
  startable,
} from "../registry"
import {
  type Change,
  logged,
  type Plan,
  send,
  tidiedInFront,
  viewOf,
} from "./arrange"
import { type Facts, NO_FACTS, widthIn } from "./arrangement"
import { focused, type Gone, NONE_GONE, soloed, type Workspaces } from "./model"
import {
  answered,
  answeredTo,
  ask,
  dropped,
  hear,
  look,
  predict,
  type Seen,
  unseen,
  Unanswered,
} from "./unheard"
import { keepView, loadView, moveOver } from "./store"
import { useArranged } from "./useArranged"

/** What the engine places a Pane by, and refuses a move by, as this client
 * believes them (ADR 0110, decision 9): solo is its own view of the row,
 * and the rules and the narrowest width are `tiling.toml`'s, as the
 * engine reads them (ADR 0127, decision 4). Which Projects are of no
 * Project each command says itself (`asking`). */
export function factsOf(
  flow: Flow,
  { rules, columns }: Pick<Tiling, "rules" | "columns"> = fileNow(TILING_FILE)
): Facts {
  return {
    flow: flow === "free" ? "free" : "row",
    home: HOME_KINDS,
    leads: LEAD_KINDS,
    rules,
    narrow: NARROW_KINDS,
    narrowest: columns.presets[0],
  }
}

const stateOf = (seen: Seen) => seen.state
const asIs = (state: Workspaces) => state
const viewIn = (seen: Seen) => seen.view
const standingIn = (seen: Seen) => seen.standing

/**
 * The Tiling's controller (ADR 0087, decision 1): the engine's arrangement
 * and the client's view of it, drawn together, and the one queue every
 * change goes through. A key's change is drawn at once, before the engine
 * answers (ADR 0088, decision 11): its command applied over the facts
 * heard and the commands sent before it (`unheard.ts`), so keys pressed
 * faster than the engine answers land in order, each on what the one
 * before drew (roma-day.spec.ts holds it), and the commands go in that
 * order. It names no App and imports nothing of the Window. `machine`,
 * `modules` and `home` are for the arrangement a window kept before,
 * which moves to the engine once. In the Flow solo, every Group and
 * every column in none is drawn the whole screen wide, on any workspace
 * (ADR 0079; ADR 0102, decision 8), but on the workspace `row` names: the
 * engine's arrangement stays as it is. `flow` is the Flow as this device
 * shows it (`flow.ts`): solo is its own view, and writes nothing (ADR
 * 0127, decision 3). In the Flow free, every workspace
 * is free, and goes emptied once the window leaves it (decision 1). A Pane
 * opened with no place is drawn where the engine would put it, by `flow`
 * (ADR 0110, decision 9).
 */
export function useTiling({
  engine,
  machine,
  modules,
  home,
  flow = "row",
  row,
  gone = NONE_GONE,
}: {
  engine: Engine
  machine: ProjectId | undefined
  modules: readonly string[]
  home: ProjectId
  flow?: Flow
  /** In solo, the workspace `Alt+M` shows as the row for a while. */
  row?: string
  /** Whether a Project's emptied workspace goes: one known to have no
   * Threads, or one the window does not know; every other Project's
   * stays (ADR 0102, decision 2). */
  gone?: Gone
}) {
  const solo = flow === "solo"
  const facts = useRef(NO_FACTS)
  const tiling = useFile(TILING_FILE)
  useLayoutEffect(() => {
    facts.current = factsOf(flow, tiling)
  }, [flow, tiling])
  // The arrangement is the engine's; the view, the window's (ADR 0025).
  const live = useArranged(engine)
  const ready = live.state === "ready"
  const [store] = useState(() => new Store(unseen(loadView())))
  // The facts heard, drawn before the frame that shows them.
  const heard = ready ? live.view : undefined
  useLayoutEffect(() => {
    if (heard) store.set(hear(store.get(), heard.workspaces, heard.at))
  }, [store, heard])
  // As drawn: in solo, whatever has the focus the screen wide.
  const drawing = useMemo(
    () => (solo ? cached((state) => soloed(state, row)) : asIs),
    [solo, row]
  )
  const workspaces = drawing(useStore(store, stateOf))
  const view = useStore(store, viewIn)
  const standing = useStore(store, standingIn)
  useEffect(() => keepView(view), [view])

  // A command that goes unanswered while the engine is connected is
  // drawn no more (rule 6); one answered waits for its fact with no clock.
  const [unanswered] = useState(
    () =>
      new Unanswered((id) => {
        // One whose fact came is drawn as the facts have it already.
        const seen = store.get()
        if (!seen.unheard.some((one) => one.id === id)) return
        console.warn("The engine did not answer a change of the workspaces")
        store.set(dropped(seen, id))
      })
  )
  useEffect(() => {
    const stop = engine.watch((status) =>
      unanswered.connected(status.state === "open")
    )
    return () => {
      stop()
      unanswered.stop()
    }
  }, [engine, unanswered])

  // A plan drawn at once and sent, in the order drawn: the engine commits
  // a session's commands to one scope in the order sent (ADR 0082,
  // decision 4), so it arranges them as the window drew them.
  const sent = useCallback(
    (plan: Plan) => {
      // What it makes takes IDs derived from its command's ID, so the
      // window draws it by the IDs the engine gives it.
      const id = newId()
      const drawn = predict(store.get(), id, plan, facts.current)
      store.set(drawn.seen)
      unanswered.sent(id)
      send(engine, plan.command, id).then(
        ({ answer, at }) => {
          unanswered.done(id)
          // The copy draws a Pane by the ID the engine gives it; one it
          // drew by another, or not at all, comes as the fact says.
          if (answer.pane && answer.pane !== drawn.opens)
            console.warn("The engine opened a Pane by another ID than drawn")
          store.set(answered(store.get(), id, at))
        },
        (error: unknown) => {
          unanswered.done(id)
          if (plan.refused) plan.refused(error)
          else logged(error)
          store.set(dropped(store.get(), id))
        }
      )
      return drawn.want
    },
    [engine, store, unanswered]
  )

  // The window's arrangement moves to the engine once (decision 2).
  useEffect(() => {
    if (!machine || modules.length === 0) return
    const first = startable(modules)[0]
    moveOver(
      engine,
      home,
      first && {
        pane: first,
        // As the engine gives a new column one, which `take` does not.
        width: widthIn(facts.current, first.kind),
        grouped: groupedOf(first),
      }
    )
      .then((kept) => kept && store.set(look(store.get(), kept)))
      .catch(logged)
  }, [engine, machine, modules, home, store])
  // An empty workspace the Person left goes, as niri's: through the
  // queue, so it is drawn gone at once and goes after what was sent
  // before it. Only the device in front tidies (`tidiedInFront`).
  const front = useInFront()
  const tidying = useRef("")
  useEffect(() => {
    const command = ready
      ? tidiedInFront(workspaces, front, gone, flow !== "free")
      : undefined
    const key = command ? JSON.stringify([command, workspaces.list.length]) : ""
    if (key === tidying.current) return
    tidying.current = key
    if (command) sent({ command, focus: false })
  }, [workspaces, ready, front, sent, gone, flow])

  // A change, worked out from what is drawn now and drawn at once; it
  // gives the Pane it focuses. One the engine refuses is drawn no more
  // once it says so.
  const changing = useCallback(
    (how: Change): Promise<string | undefined> => {
      const seen = store.get()
      const now = drawing(seen.state)
      const next = how(now)
      if (!next || next === now) return Promise.resolve(undefined)
      if ("command" in next) return Promise.resolve(sent(next))
      // The view alone.
      store.set(look(seen, viewOf(next)))
      return Promise.resolve(focused(next)?.id)
    },
    [store, sent, drawing]
  )
  const change = useCallback(
    (how: Change) => changing(how).then(() => undefined),
    [changing]
  )
  // A Pane's new args are drawn at once, and kept until their event is.
  const update = useCallback(
    (pane: string, { args }: PaneState) => {
      store.set(ask(store.get(), pane, args, Infinity))
      // Kept only while they are the args asked for last: an answer says
      // until when, a refusal draws the engine's again.
      const until = (place: number) => {
        const seen = store.get()
        if (seen.asked[pane]?.args === args)
          store.set(ask(seen, pane, args, place))
      }
      // Its answer raises how far the engine answered this window, as a
      // key's does: an update after it that finds its args there already
      // is kept until this one's fact is heard, so the args before it are
      // not drawn back meanwhile.
      engine.commandAt("workspaces.update", { pane, args }).then(
        ({ at }) => {
          store.set(answeredTo(store.get(), at))
          until(store.get().answered)
        },
        (error: unknown) => {
          logged(error)
          until(0)
        }
      )
    },
    [engine, store]
  )
  // The workspaces as last drawn, for what runs between draws.
  const drawnNow = useCallback(
    () => drawing(store.get().state),
    [store, drawing]
  )
  // The same for what the Window draws, read by selector (`kept.ts`):
  // as drawn, solo and all, and read only, as only the Tiling changes
  // them. Another once solo or Alt+M's row changes, so each reader reads
  // again.
  const readable = useMemo<Readable<Workspaces>>(
    () => ({ get: drawnNow, subscribe: store.subscribe }),
    [drawnNow, store]
  )
  // The workspaces set aside, while they are (ADR 0039, decision 2).
  const aside = (ready && live.view.aside) || null
  return {
    ready,
    aside,
    workspaces,
    standing,
    drawnNow,
    store: readable,
    changing,
    change,
    update,
  }
}

/** `draw`, kept for the last state it drew, so the same state draws as
 * the same object. */
function cached(
  draw: (state: Workspaces) => Workspaces
): (state: Workspaces) => Workspaces {
  let was: Workspaces | undefined
  let drawn: Workspaces | undefined
  return (state) => {
    if (state !== was || drawn === undefined) {
      was = state
      drawn = draw(state)
    }
    return drawn
  }
}
