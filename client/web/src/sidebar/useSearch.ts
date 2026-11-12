/**
 * Search in the messages, on every machine (ADR 0098, decision 17; spec
 * S12c): each machine's engine searches its own Projects' messages, as
 * the modules that list them ask it (`ListSearch`), and the window asks
 * each machine it reaches, through its session, a moment after the last
 * key. One away is read by its
 * titles alone, and says so. An answer that comes late, for words no
 * longer typed or machines no longer asked, is dropped.
 */
import { useContext, useEffect, useMemo, useState } from "react"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import { HostsContext, type Shown } from "@banda/core/react"
import type { Finding } from "@banda/ui/module"
import type { Lists } from "@banda/ui/pane"
import { searches } from "../registry"
import {
  answered,
  HERE,
  type Names,
  NO_ANSWERS,
  type Plan,
  planOf,
  type Query,
  type Searchable,
  type Searched,
  searchedOf,
} from "./search"

/** How long Search waits after the last key before it asks the machines,
 * in ms: a word typed whole asks once. */
export const SETTLE = 150

/** How a search asks the engine of the machine that has `project` for
 * its messages that hold `words`. */
export type Ask = (
  project: ProjectId,
  words: string
) => Promise<readonly Finding[]>

/**
 * Asks each machine `plan` reaches for its words, `settle` ms from now,
 * all its Projects at once, and hands `take` each machine's answer once
 * all of them answered: what they found, or none where every one failed.
 * Returns how to stop: an answer that comes after is dropped.
 */
export function askAll(
  plan: Plan,
  ask: Ask,
  take: (machine: string, found: Finding[] | undefined) => void,
  settle = SETTLE
): () => void {
  let asking = true
  const timer = setTimeout(() => {
    for (const [machine, projects] of plan.asks)
      void Promise.allSettled(
        projects.map(async (project) => ask(project, plan.words))
      ).then((answers) => {
        if (!asking) return
        const found = answers.flatMap((one) =>
          one.status === "fulfilled" ? one.value : []
        )
        const any = answers.some((one) => one.status === "fulfilled")
        take(machine, any ? found : undefined)
      })
  }, settle)
  return () => {
    asking = false
    clearTimeout(timer)
  }
}

/** Another machine whose rows the list shows, as a search reads it: with
 * its Projects, reached while it is live. */
const searchable = (host: Shown): Searchable => ({
  key: host.name,
  projects: host.projects,
  reached: host.state.state === "live",
})

/**
 * What a search in place finds in the messages while `query` runs: this
 * machine's `projects` and those of the other machines whose rows the
 * list shows (`hosts`), each asked through its own session, those that
 * list something in `lists`, as the query's filters, `names` and `only`
 * narrow them. None while no word is typed. The same plan asks once,
 * however the lists change meanwhile.
 */
export function useSearch(
  query: Query | undefined,
  lists: Lists,
  projects: readonly ProjectSummary[],
  hosts: readonly Shown[],
  names: Names,
  only?: ProjectId
): Searched | undefined {
  const kept = useContext(HostsContext)
  const fresh = useMemo(
    () =>
      query &&
      planOf(
        query,
        [{ key: HERE, projects, reached: true }, ...hosts.map(searchable)],
        (project) => (lists[project]?.length ?? 0) > 0,
        names,
        only
      ),
    [query, projects, hosts, lists, names, only]
  )
  // The plan asked, kept while it says the same: a list that changes
  // asks nothing again.
  const [plan, setPlan] = useState(fresh)
  if (fresh?.key !== plan?.key) setPlan(fresh)
  const [answers, setAnswers] = useState(NO_ANSWERS)
  useEffect(() => {
    if (!plan) return
    return askAll(
      plan,
      // Each module that searches what it lists, in the session of the
      // machine that has the Project.
      async (project, words) => {
        const session = kept.sessionOf(project)
        const found = await Promise.all(
          searches.map((search) => search(session, project, words))
        )
        return found.flat()
      },
      (machine, found) =>
        setAnswers((was) => answered(was, plan, machine, found))
    )
  }, [kept, plan])
  return useMemo(() => searchedOf(answers, plan), [answers, plan])
}
