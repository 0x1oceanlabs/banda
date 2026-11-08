/**
 * A Thread that woke from its snooze by itself is told of once (ADR 0074,
 * decision 7): one that calls, by its call; one that does not, by the
 * notifications module, here. It is the calls part's, as what calls is: it
 * looks as the calls follow the lists and the snooze clock.
 */
import { useEffect } from "react"
import type { ProjectId } from "@banda/contract"
import type { Args } from "@banda/ui/module"
import { asleep, type Listed, wokeOf } from "@banda/ui/pane"
import type { Stores } from "./stores"

/** What the notifications module tells of a Thread that woke by itself
 * with nothing that calls: one that calls is told of by its call. Its
 * button opens it. */
export function wokeTold(project: ProjectId, listed: Listed): Args {
  const { id: about, title, pane } = listed
  return {
    key: `woke:${project}:${about}`,
    kind: "done",
    title,
    body: "Woke from its snooze",
    in: project,
    about,
    buttons: [
      {
        label: "Open",
        // The notifications module's GO_TO: the window names a module's
        // action by its id, not its package.
        action: "notifications.go-to",
        args: { project, about, pane },
      },
    ],
  }
}

/** Tells, by `run`, of each Thread `stores` list that wakes by itself
 * from here on, once, and of none that calls; returns how to stop. */
export function tellWoke(
  stores: Stores,
  run: (action: string, args?: Args) => void
): () => void {
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
          wokeOf(one.snooze, now) !== undefined
        )
          run("notifications.tell", wokeTold(project as ProjectId, one))
      }
  }
  look()
  return stores.calls.subscribe(look)
}

/** `tellWoke` for as long as the Window is drawn. */
export function useWokeNote(
  stores: Stores,
  run: (action: string, args?: Args) => void
): void {
  useEffect(() => tellWoke(stores, run), [stores, run])
}
