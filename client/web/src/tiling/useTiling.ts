import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import {
  type Engine,
  Lost,
  newId,
  type ProjectId,
  Refused,
} from "@banda/contract"
import { Store, useStore } from "@banda/core/react"
import type { PaneState } from "@banda/ui/pane"
import { groupedOf, startable, widthOf } from "../registry"
import { type Change, type Plan, send, tidied, viewOf } from "./arrange"
import { focused } from "./model"
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

/** A change the engine refused is logged: the window draws what it says.
 * One whose answer was lost may have run: its fact draws it, if it did. */
function refused(error: unknown): void {
  const lost =
    error instanceof Lost ||
    (error instanceof Refused && error.refusal.code === "may_have_run")
  if (lost) console.warn("A change of the workspaces may have run:", error)
  else console.warn("The workspaces did not change:", error)
}

const stateOf = (seen: Seen) => seen.state
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
 * which moves to the engine once.
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
  const [store] = useState(() => new Store(unseen(loadView())))
  // The facts heard, drawn before the frame that shows them.
  const heard = ready ? live.view : undefined
  useLayoutEffect(() => {
    if (heard) store.set(hear(store.get(), heard.workspaces, heard.at))
  }, [store, heard])
  const workspaces = useStore(store, stateOf)
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
      const drawn = predict(store.get(), id, plan)
      store.set(drawn.seen)
      unanswered.sent(id)
      send(engine, plan.command, id).then(
        ({ answer, at }) => {
          unanswered.done(id)
          // The copy draws a Pane by the ID the engine gives it; one it
          // drew by another, or not at all, comes as the fact says.
          if (answer.pane && answer.pane !== drawn.opens)
            console.warn("The engine opened a Pane by another ID than drawn")
          const place = answer.at === null ? null : (at ?? answer.at)
          store.set(answered(store.get(), id, place))
        },
        (error: unknown) => {
          unanswered.done(id)
          refused(error)
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
        width: widthOf(first),
        grouped: groupedOf(first),
      }
    )
      .then((kept) => kept && store.set(look(store.get(), kept)))
      .catch(refused)
  }, [engine, machine, modules, home, store])
  // An empty workspace the Person left goes, as niri's: through the
  // queue, so it is drawn gone at once and goes after what was sent
  // before it.
  const tidying = useRef("")
  useEffect(() => {
    const command = ready ? tidied(workspaces) : undefined
    const key = command ? JSON.stringify([command, workspaces.list.length]) : ""
    if (key === tidying.current) return
    tidying.current = key
    if (command) sent({ command, focus: false })
  }, [workspaces, ready, sent])

  // A change, worked out from what is drawn now and drawn at once; it
  // gives the Pane it focuses. One the engine refuses is drawn no more
  // once it says so.
  const changing = useCallback(
    (how: Change): Promise<string | undefined> => {
      const seen = store.get()
      const next = how(seen.state)
      if (!next || next === seen.state) return Promise.resolve(undefined)
      if ("command" in next) return Promise.resolve(sent(next))
      // The view alone.
      store.set(look(seen, viewOf(next)))
      return Promise.resolve(focused(next)?.id)
    },
    [store, sent]
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
      engine.command("workspaces.update", { pane, args }).then(
        (done) => {
          store.set(answeredTo(store.get(), done.at))
          until(store.get().answered)
        },
        (error: unknown) => {
          refused(error)
          until(0)
        }
      )
    },
    [engine, store]
  )
  // The workspaces as last drawn, for what runs between draws.
  const drawnNow = useCallback(() => store.get().state, [store])
  // The workspaces set aside, while they are (ADR 0039, decision 2).
  const aside = (ready && live.view.aside) || null
  return {
    ready,
    aside,
    workspaces,
    standing,
    drawnNow,
    changing,
    change,
    update,
  }
}
