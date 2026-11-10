/**
 * A Thread that woke from its Later by itself is told of once (ADR 0074,
 * decision 7): one that calls, by its call; one that does not, by the
 * notifications module, here. It is told as its host says it woke
 * (`thread.woke`, by its time or as its turn ended), not as each window's
 * clock passes its time: the host's word is the one moment, whichever
 * windows are open. It is the calls part's, as what calls is: it looks as
 * the calls follow the lists.
 */
import { useEffect } from "react"
import type { ProjectId } from "@banda/contract"
import { MINUTE } from "@banda/ui/lib/words"
import type { Args } from "@banda/ui/module"
import type { Listed } from "@banda/ui/pane"
import { wokeAt } from "@banda/ui/status"
import type { Stores } from "./stores"

/** How long after it woke a Thread is still told of. Past that its card
 * says so alone: the host's first start after a while writes the wake of
 * every Later whose time passed meanwhile, each at its own time. */
const TOLD_FOR = 10 * MINUTE

/** What the notifications module tells of a Thread that woke by itself
 * with nothing that calls: one that calls is told of by its call. Its
 * button opens it. */
export function wokeTold(project: ProjectId, listed: Listed): Args {
  const { id: about, title, pane } = listed
  return {
    key: `woke:${project}:${about}`,
    kind: "done",
    title,
    body: "Woke from Later",
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

/**
 * Tells, by `run`, of each Thread `stores` list whose host says it woke by
 * itself, once for each Later: not of one that calls, which its call
 * tells of; not of one its Person woke or saw wake, on this machine or
 * another; and not of one that woke over `TOLD_FOR` ago. Returns how to
 * stop.
 */
export function tellWoke(
  stores: Stores,
  run: (action: string, args?: Args) => void
): () => void {
  // Each Later's waking is heard once, told or not, by its Thread and
  // when it was put off.
  const heard = new Set<string>()
  const look = () => {
    const lists = stores.items.get()
    const calls = new Set(stores.calls.get().list.map((call) => call.key))
    const now = Date.now()
    for (const [project, listed] of Object.entries(lists))
      for (const one of listed) {
        const later = one.later
        if (!later?.woke) continue
        const key = `${project}:${one.id}`
        const once = `${key}@${later.at}`
        if (heard.has(once)) continue
        heard.add(once)
        const at = wokeAt(one, now)
        if (calls.has(key) || at === undefined || now - at > TOLD_FOR) continue
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
