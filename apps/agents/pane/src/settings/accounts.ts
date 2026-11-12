/**
 * Settings → Agents' accounts (ADR 0093, decisions 6 and 9): a card per
 * account, by Harness, with its plan, its limits and what Banda knows of
 * it. The words and sums here are plain data, so plain tests cover them.
 */
import { useCallback } from "react"
import type { Engine } from "@banda/contract"
import type { AccountUse } from "@banda/contract/agents"
import type {
  AccountKind,
  AccountList,
  Adds,
  Gateway,
  HarnessView,
  Limits,
  LimitWindow,
  SignedInAs,
  StartRole,
} from "@banda/contract/harnesses"
import { useInFront } from "@banda/ui/hooks/use-in-front"
import { useRead } from "@banda/ui/hooks/use-read"
import { openProjects } from "@banda/ui/lib/projects"
import { DAY, ago } from "@banda/ui/lib/words"
import { groupedByHarness, harnessTitle } from "../harnesses"

/** What Banda knows of an account on this machine: its Threads now, when
 * its latest turn began, and its turns this week. */
export type Use = { threads: number; last?: number; turns: number }

/** An account no Thread used. */
const UNUSED: Use = { threads: 0, turns: 0 }

/** Monday 00:00 of the week `now` is in, on this computer's clock: from
 * when "this week" counts. */
export function weekStart(now: number): number {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  const sinceMonday = (day.getDay() + 6) % 7
  day.setDate(day.getDate() - sinceMonday)
  return day.getTime()
}

/** Each account's use summed over the Projects' answers. */
export function usesOf(
  projects: readonly (readonly AccountUse[])[]
): Map<string, Use> {
  const uses = new Map<string, Use>()
  for (const { harness, threads, last, turns } of projects.flat()) {
    const was = uses.get(harness) ?? UNUSED
    const latest =
      last === undefined || (was.last ?? 0) > last ? was.last : last
    uses.set(harness, {
      threads: was.threads + threads,
      turns: was.turns + turns,
      ...(latest !== undefined && { last: latest }),
    })
  }
  return uses
}

/** How the machine's Projects use each account, read as the section
 * opens and as the window comes to the front; a Project that does not
 * answer counts none. */
export function useUses(engine: Engine): Map<string, Use> | undefined {
  const front = useInFront()
  const read = useRead(
    useCallback(
      async () => {
        const since = weekStart(Date.now())
        const projects = openProjects(await engine.call("projects.list", {}))
        const asked = projects.map(({ id: project }) =>
          engine
            .call("agents.accounts", { since }, { project })
            .catch((): AccountUse[] => [])
        )
        return usesOf(await Promise.all(asked))
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps -- asked again on purpose
      [engine, front]
    )
  )
  return read.state === "ready" ? read.value : undefined
}

/** The entries by Harness, each Harness where its first entry stands,
 * with the name its group shows, as their machine says it. */
export function groupsOf(
  answer: Pick<AccountList, "accounts" | "harnesses">
): { harness: string; name: string; accounts: HarnessView[] }[] {
  return groupedByHarness(answer.accounts).map(([harness, accounts]) => ({
    harness,
    accounts,
    name: harnessTitle(answer, harness),
  }))
}

/** The first of `id`, `id-2`, `id-3`… that no entry has. */
export function freeId(id: string, taken: readonly HarnessView[]): string {
  const free = (one: string) => taken.every((entry) => entry.id !== one)
  if (free(id)) return id
  let n = 2
  while (!free(`${id}-${n}`)) n++
  return `${id}-${n}`
}

/** The gateways Banda knows for a Harness, as its machine says them
 * (ADR 0078, decision 1), and one of the Person's own, which has no
 * address yet. */
export function gatewaysOf(adds: Adds): readonly Gateway[] {
  return [...adds.gateways, { id: "gateway", name: "Gateway", url: "" }]
}

/** How an account pays, as its page says it. */
export const KIND_WORDS: Readonly<Record<AccountKind, string>> = {
  subscription: "Subscription",
  api: "API key",
  gateway: "Gateway",
}

/** The plan and email a card shows under the name: the limits' plan, else
 * what the Harness calls the sign-in, and the email of either. */
export function whoWords(
  limits: Limits | undefined,
  who: SignedInAs | undefined
): string | undefined {
  const signedIn = who?.signed_in ? who : undefined
  const plan = limits?.plan ?? signedIn?.label
  const email = signedIn?.email ?? limits?.email
  return [plan, email].filter(Boolean).join(" · ") || undefined
}

/** The windows a card shows: the account's own two, which come first,
 * before those of one model. */
export function cardWindows(limits: Limits | undefined): LimitWindow[] {
  return limits?.windows.slice(0, 2) ?? []
}

/** "1 Thread", "No Threads". */
export function threadsWords(threads: number): string {
  if (threads === 0) return "No Threads"
  return `${threads} Thread${threads === 1 ? "" : "s"}`
}

/** When an account was last used: "Used now", "Used 2h ago", "Used
 * Nov 2"; "Not used yet" for one no turn ran on. */
export function lastWords(last: number | undefined, now: number): string {
  if (last === undefined) return "Not used yet"
  const when = ago(last, now)
  if (when === "now") return "Used now"
  return now - last < 7 * DAY ? `Used ${when} ago` : `Used ${when}`
}

/** Chooses where a new Thread starts, or where it starts while that one
 * is out; with no account, takes the choice back. */
export function pickStart(
  engine: Engine,
  role: StartRole,
  id: string | undefined
): Promise<string[]> {
  return engine
    .command("harnesses.set_start", {
      role,
      ...(id !== undefined && { harness: id }),
    })
    .then(() => [])
}
