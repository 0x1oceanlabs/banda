import { useCallback, useEffect, useRef, useState } from "react"
import { type Engine, newId, type ProjectId } from "@banda/contract"
import type { Arranged } from "@banda/contract/workspaces"
import type { PaneState } from "@banda/ui/pane"
import { groupedOf, startable, widthOf } from "../registry"
import {
  type Asked,
  type Change,
  NO_VIEW,
  resolve,
  send,
  tidied,
  type View,
  viewOf,
  withAsked,
} from "./arrange"
import { focused, type Workspaces as State } from "./model"
import { keepView, loadView, moveOver } from "./store"
import { useArranged } from "./useArranged"

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
 * The Tiling's controller (ADR 0087, decision 1): the engine's arrangement
 * and the client's view of it, drawn together, and the one queue every
 * change goes through. Each change is worked out from what the last one
 * drew, so keys pressed faster than the window draws land in order, each
 * on what the one before did (roma-day.spec.ts holds it). It names no App
 * and imports nothing of the Window. `machine`, `modules` and `home` are
 * for the arrangement a window kept before, which moves to the engine once.
 */
export function useTiling({
  engine,
  machine,
  modules,
  home,
}: {
  engine: Engine
  machine: ProjectId | undefined
  modules: readonly string[]
  home: ProjectId
}) {
  // The arrangement is the engine's; the view, the window's (ADR 0025).
  const live = useArranged(engine)
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
    moveOver(
      engine,
      home,
      first && {
        pane: first,
        width: widthOf(first),
        grouped: groupedOf(first),
      }
    )
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
  // What is drawn, for what runs between draws; and the changes that
  // wait to see theirs drawn, each with when it is.
  const waiting = useRef(new Set<(seen: Seen) => boolean>())
  const seenNow = useRef(drawing)
  useEffect(() => {
    seenNow.current = drawing
    for (const drawn of waiting.current)
      if (drawn(drawing)) waiting.current.delete(drawn)
  }, [drawing])

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
        // The change's command ID: what it makes takes IDs derived from
        // it, so a client can draw it before the engine answers.
        const id = newId()
        const answer = (await send(engine, next.command, id)) as {
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
  // The workspaces as last drawn, for what runs between draws.
  const drawnNow = useCallback(() => seenNow.current.state, [])
  // The workspaces set aside, while they are (ADR 0039, decision 2).
  const aside = (ready && live.view.aside) || null
  return { ready, aside, workspaces, drawnNow, changing, change, update }
}
