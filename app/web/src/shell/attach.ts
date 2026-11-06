/**
 * Where what an App attaches goes (ADR 0073, decision 14): the composers
 * the Panes drawn say they have (`PaneProps.composer`), by their entry,
 * and the Panes that had the focus, the latest first. The window knows no
 * module: a Thread says it has a composer, as it says its label.
 */
import type { ProjectId } from "@banda/contract"
import type { Chip } from "@banda/ui/module"

/** A Pane's composer, and the Project the Pane is in. */
export type Composer = {
  project: ProjectId
  take: (chips: readonly Chip[]) => void
}

/** The composers of the Panes drawn, by their entry. */
const composers = new Map<string, Composer>()

/** The entries that had the focus, the latest first. */
let history: string[] = []

/** How many entries {@link history} keeps. */
const KEPT = 64

/** Keeps the composer the Pane of `entry` in `project` says it has, or
 * with `null` forgets it. */
export function sayComposer(
  entry: string,
  project: ProjectId,
  take: Composer["take"] | null
): void {
  if (take) composers.set(entry, { project, take })
  else composers.delete(entry)
}

/** Notes that `entry` has the focus now. */
export function focusedOn(entry: string): void {
  history = [entry, ...history.filter((one) => one !== entry)].slice(0, KEPT)
}

/**
 * The entry whose composer takes what is attached: the focused Pane's, if
 * it has one; else the one that had the focus last in the focused Pane's
 * Project; none else, or with no Pane focused.
 */
export function composerFor(
  focused: { id: string; project: ProjectId } | null,
  history: readonly string[],
  composers: ReadonlyMap<string, Pick<Composer, "project">>
): string | null {
  if (!focused) return null
  if (composers.has(focused.id)) return focused.id
  return (
    history.find((id) => composers.get(id)?.project === focused.project) ?? null
  )
}

/** Where `chips` go, for the focused Pane: its entry and how its
 * composer takes them; none when no Thread takes them. */
export function attachTo(
  focused: { id: string; project: ProjectId } | null
): { entry: string; take: Composer["take"] } | null {
  const entry = composerFor(focused, history, composers)
  const take = entry === null ? undefined : composers.get(entry)?.take
  return entry !== null && take ? { entry, take } : null
}
