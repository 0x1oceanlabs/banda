/**
 * A Project's pull requests as the window's items (ADR 0076): pure, so
 * plain tests cover it.
 */
import type { Listed as Pulls, Pull } from "@banda/contract/pulls"
import type { Listed } from "@banda/ui/pane"

/** What an item on a Thread takes of it: its id, its Agent, what a click
 * opens. */
export type Thread = Pick<Listed, "id" | "pane"> & { agent: string }

/** The Threads among a Project's items, as `itemsOf` takes them: each one
 * an Agent works in. */
export function threadsIn(listed: readonly Listed[]): Thread[] {
  return listed.flatMap(({ id, agent, pane }) =>
    agent === undefined ? [] : [{ id, agent, pane }]
  )
}

/**
 * One item for each of `threads` that links a pull request, `on` its
 * Agent (ADR 0029, decision 6), with its pull requests in the order the
 * engine lists them, the most urgent first: the sidebar puts them on the
 * Thread's card (ADR 0098, decision 8), and the item has no row of its
 * own. Its mark rests, so it calls no one. A Thread the window does not
 * list has none.
 */
export function itemsOf(pulls: Pulls, threads: readonly Thread[]): Listed[] {
  const linked = new Map<string, Pull[]>()
  for (const pull of pulls.pulls)
    for (const thread of pull.threads)
      linked.set(thread, [...(linked.get(thread) ?? []), pull])
  return threads.flatMap(({ id, agent, pane }) => {
    const its = linked.get(id)
    if (!its) return []
    return [
      {
        id: `pulls:${id}`,
        title: its.map(({ number }) => `#${number}`).join(", "),
        mark: "rest",
        // When it last changed on GitHub; 0 before it was read.
        changed: Math.max(
          0,
          ...its.map((pull) => pull.snapshot?.updated_at ?? 0)
        ),
        on: agent,
        pane,
        pulls: its,
      },
    ]
  })
}
