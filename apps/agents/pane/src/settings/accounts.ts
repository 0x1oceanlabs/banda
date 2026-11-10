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
  HarnessView,
  Limits,
  LimitWindow,
  SignedInAs,
} from "@banda/contract/harnesses"
import { tomlOf } from "@banda/contract/settings"
import { useInFront } from "@banda/ui/hooks/use-in-front"
import { useRead } from "@banda/ui/hooks/use-read"
import { openProjects } from "@banda/ui/lib/projects"
import { DAY, ago } from "@banda/ui/lib/words"
import { groupedByHarness, harnessTitle } from "../harnesses"
import type { SettingsFile } from "./AgentsSettings"

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
 * with the name its group shows. */
export function groupsOf(
  list: readonly HarnessView[]
): { harness: string; name: string; accounts: HarnessView[] }[] {
  return groupedByHarness(list).map(([harness, accounts]) => ({
    harness,
    accounts,
    name: harnessTitle(accounts, harness),
  }))
}

/** What a new account of `harness` is called and coloured, after the
 * ones it has: `C4` beside C1 to C3, else `Claude Code 2`; the colour of
 * the four its accounts use least, so no two share one while they can.
 * It is written with the account; the engine's `looks()` gives those that
 * name none the colours left, by the same rule, and its `fresh()` names
 * and colours an account added without a name, from the CLI, alike. */
export function newAccountOf(
  harness: string,
  taken: readonly HarnessView[]
): { name: string; colour: number } {
  const theirs = taken.filter((one) => one.harness === harness)
  const numbered = theirs.map((one) => one.name.match(/^(.*?)(\d+)$/))
  const prefix = numbered[0]?.[1]
  const name =
    prefix !== undefined && numbered.every((one) => one?.[1] === prefix)
      ? `${prefix}${Math.max(...numbered.map((one) => Number(one![2]))) + 1}`
      : `${harnessTitle(taken, harness)} ${theirs.length + 1}`
  const uses = [1, 2, 3, 4].map(
    (colour) => theirs.filter((one) => one.colour === colour).length
  )
  return { name, colour: uses.indexOf(Math.min(...uses)) + 1 }
}

/** The first of `id`, `id-2`, `id-3`… that no entry has. */
export function freeId(id: string, taken: readonly HarnessView[]): string {
  const free = (one: string) => taken.every((entry) => entry.id !== one)
  if (free(id)) return id
  let n = 2
  while (!free(`${id}-${n}`)) n++
  return `${id}-${n}`
}

/** A gateway the Add account step knows (ADR 0078, decision 1): its
 * address for each Harness that speaks to it, Anthropic's API for Claude
 * Code and OpenAI's Responses API for Codex. */
export interface Gateway {
  id: string
  name: string
  urls: Readonly<Partial<Record<string, string>>>
}

const GATEWAYS: readonly Gateway[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    urls: {
      claude: "https://openrouter.ai/api",
      codex: "https://openrouter.ai/api/v1",
    },
  },
  {
    id: "zai",
    name: "z.ai",
    urls: { claude: "https://api.z.ai/api/anthropic" },
  },
  {
    id: "kimi",
    name: "Kimi",
    urls: { claude: "https://api.moonshot.ai/anthropic" },
  },
  {
    id: "litellm",
    name: "LiteLLM",
    urls: {
      claude: "http://localhost:4000",
      codex: "http://localhost:4000/v1",
    },
  },
]

/** The gateways `harness` speaks to, and one of the Person's own, which
 * has no address yet. */
export function gatewaysOf(harness: string): readonly Gateway[] {
  return [
    ...GATEWAYS.filter((gateway) => gateway.urls[harness]),
    { id: "gateway", name: "Gateway", urls: {} },
  ]
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

/** Sets where a new Thread starts, `start.account`, or the fallback,
 * `start.fallback`, in `agents.toml`; with no account, takes it out. */
export function pickStart(
  file: SettingsFile,
  key: "start.account" | "start.fallback",
  id: string | undefined
): Promise<string[]> {
  return id === undefined ? file.reset(key) : file.set(key, tomlOf(id))
}
