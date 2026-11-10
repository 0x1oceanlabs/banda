/**
 * The Harnesses this computer can start, and who is signed in to each, as
 * the Panes show them: the machine's module `harnesses` (ADR 0040), which
 * names no Project.
 */
import type { HarnessView } from "@banda/contract/harnesses"

export { useAccount, useHarnesses } from "@banda/ui/hooks/use-harnesses"

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

/** The Harnesses Banda knows, by what their accounts are grouped under:
 * the Harness's own entry may be renamed `Work`, or `C1`. */
const PROGRAMS: Readonly<Record<string, string>> = {
  claude: "Claude Code",
  codex: "Codex",
}

/** What the accounts of `harness`, as an entry's `harness` says it, are
 * grouped under: `Claude Code`, never one account's name. */
export function harnessTitle(
  harnesses: readonly Pick<HarnessView, "id" | "name" | "harness">[],
  harness: string
): string {
  return (
    PROGRAMS[harness] ??
    harnesses.find((one) => one.id === harness)?.name ??
    harnesses.find((one) => one.harness === harness)?.name ??
    harness
  )
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
