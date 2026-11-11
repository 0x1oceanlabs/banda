/**
 * Where what an App attaches goes (ADR 0073, decision 14): the composers
 * the Panes drawn say they have (`PaneProps.composer`), by their entry,
 * and the Panes that had the focus, the latest first. The window knows no
 * module: a Thread says it has a composer, as it says its label.
 */
import type { JsonValue, ProjectId } from "@banda/contract"
import { fileAcross, type Hosts, projectFile } from "@banda/core"
import { toast } from "@banda/ui/components/sonner"
import { THIS_COMPUTER } from "@banda/ui/lib/outside"
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
 * The entry whose composer takes what is attached of `project`, on its
 * own machine alone (ADR 0106, laws 2 and 3): the focused Pane's, if it
 * has one in that Project; else the one that had the focus last in that
 * Project; none else, or with no Pane focused. A Project's path means
 * nothing in another's Message box, whatever Pane has the focus.
 */
export function composerFor(
  focused: { id: string; project: ProjectId } | null,
  project: ProjectId,
  history: readonly string[],
  composers: ReadonlyMap<string, Pick<Composer, "project">>
): string | null {
  if (!focused) return null
  if (composers.get(focused.id)?.project === project) return focused.id
  return history.find((id) => composers.get(id)?.project === project) ?? null
}

/** Where chips of `project` go, for the focused Pane: its entry and how
 * its composer takes them; none when no Thread of that Project does. */
export function attachTo(
  focused: { id: string; project: ProjectId } | null,
  project: ProjectId
): { entry: string; take: Composer["take"] } | null {
  const entry = composerFor(focused, project, history, composers)
  const take = entry === null ? undefined : composers.get(entry)?.take
  return entry !== null && take ? { entry, take } : null
}

/**
 * Puts `chips` in the Message box of a Thread of their Project (ADR 0106,
 * laws 2 and 3), going to its entry with `go`. Nothing takes them, and
 * one toast says so, however many were added at once: a file of another
 * machine says where it is (#1445), any other that no Thread of its
 * Project is here.
 */
export function attachChips(
  chips: Chip | readonly Chip[],
  focused: { id: string; project: ProjectId } | undefined,
  hosts: Hosts,
  go: (entry: string) => void
): void {
  const list: readonly Chip[] = Array.isArray(chips) ? chips : [chips]
  const project = list.find((chip) => chip.project)?.project ?? focused?.project
  const to = project && attachTo(focused ?? null, project)
  if (to) {
    go(to.entry)
    return to.take(list)
  }
  const why =
    focused && project && list[0]
      ? fileAcross(
          hosts,
          projectFile(project, list[0].path),
          focused.project,
          THIS_COMPUTER
        )
      : undefined
  toast.warning(why ?? "No Thread in this Project to add it to.", {
    id: "attach",
  })
}

/** The chip `file.attach`'s args name: the file at `path`, and the lines
 * `from` and `to` with what is said of them and how they read, when
 * given. */
export function chipOf(
  path: string,
  args: { readonly [key: string]: JsonValue },
  project?: ProjectId
): Chip {
  const { from, to, comment, text } = args
  const lines =
    typeof from === "number" && typeof to === "number"
      ? ([Math.min(from, to), Math.max(from, to)] as const)
      : undefined
  return {
    path,
    ...(project !== undefined && { project }),
    ...(lines && { lines }),
    ...(typeof comment === "string" && comment.trim()
      ? { comment: comment.trim() }
      : {}),
    ...(lines && typeof text === "string" ? { text } : {}),
  }
}
