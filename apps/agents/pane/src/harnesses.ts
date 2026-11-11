/**
 * The Harnesses this computer can start, and who is signed in to each, as
 * the Panes show them: the machine's module `harnesses` (ADR 0040), which
 * names no Project.
 */
import type { AccountList, HarnessView } from "@banda/contract/harnesses"

export {
  useAccount,
  useAccounts,
  useHarnesses,
} from "@banda/ui/hooks/use-harnesses"

/** What a sentence calls a Harness, `Claude` for Claude Code, or its ID
 * when this computer does not know it. */
export function harnessShort(harnesses: HarnessView[], id: string): string {
  return harnesses.find((harness) => harness.id === id)?.short ?? id
}

/** A Harness's name, or `unknown` when this computer does not know it:
 * its ID, unless the caller kept its name (ADR 0105, Q6). */
export function harnessName(
  harnesses: HarnessView[],
  id: string,
  unknown = id
): string {
  return harnesses.find((harness) => harness.id === id)?.name ?? unknown
}

/** What the accounts of `harness`, as an entry's `harness` says it, are
 * grouped under, as their machine says it (ADR 0108, decision 4): `Claude
 * Code`, never one account's name. Its ID while the machine has not said. */
export function harnessTitle(
  answer: Pick<AccountList, "harnesses"> | undefined,
  harness: string
): string {
  return answer?.harnesses.find((one) => one.id === harness)?.title ?? harness
}

/** `list`'s entries by the Harness they run, each Harness where its first
 * entry stands: an account found after another Harness joins its own. */
export function groupedByHarness<T extends { harness: string }>(
  list: readonly T[]
): [harness: string, entries: T[]][] {
  const groups = new Map<string, T[]>()
  for (const one of list) {
    const group = groups.get(one.harness)
    if (group) group.push(one)
    else groups.set(one.harness, [one])
  }
  return [...groups]
}

/** `list` with each Harness's accounts together ({@link groupedByHarness}). */
export function byHarness<T extends { harness: string }>(
  list: readonly T[]
): T[] {
  return groupedByHarness(list).flatMap(([, entries]) => entries)
}
