/**
 * Arrange by Project as the Person asks for it, from the Banda menu or the
 * sidebar's Flow menu, and its Undo (ADR 0102, decision 9). A toast says
 * it, and its Undo, or `workspaces.unarrange`'s key (Ctrl+Z, ⌘Z on a
 * Mac) while it shows, puts the workspaces back as they stood; once they
 * changed since, the engine refuses, and its words show. The Arrange a
 * Thread made a Project's asks for (`made.ts`) says nothing.
 */
import { newId } from "@banda/contract"
import { sameData } from "@banda/core"
import { toast } from "@banda/ui/components/sonner"
import { FIELDS } from "@banda/ui/lib/keys"
import { problem } from "@banda/ui/lib/words"
import { IN_PROGRAM } from "@banda/ui/pane"
import { keptOf, type Plan } from "../tiling/arrange"
import { apply } from "../tiling/arrangement"
import { focused, type Workspaces } from "../tiling/model"
import type { Shell } from "./actions"

/** The one toast an Arrange says itself in: the next one takes its place. */
const ARRANGED = "workspaces.arranged"

/** Where Ctrl+Z is the focus's own: a field, or a program, as in a
 * terminal. */
const OWN_UNDO = `${FIELDS},${IN_PROGRAM}`

/** What undoes the Arrange the toast shows, while it shows. */
let shown: (() => void) | undefined

/** Whether `plan` moves anything of `workspaces`, as the window's copy of
 * the engine's commands works it out. */
function moves(workspaces: Workspaces, plan: Plan): boolean {
  const list = keptOf(workspaces)
  const applied = apply(list, plan.command, newId())
  return "list" in applied && !sameData(applied.list, list)
}

/** Says `plan`, an Arrange by Project the Person asked for, of
 * `workspaces`: one that moves something offers Undo; one that moves
 * nothing says so. Gives the plan, to send. */
export function sayArranged(
  shell: Pick<Shell, "change">,
  workspaces: Workspaces,
  plan: Plan
): Plan {
  if (!moves(workspaces, plan)) {
    shown = undefined
    toast("Already arranged by Project", { id: ARRANGED, action: undefined })
    return plan
  }
  const undo = () => {
    if (shown === undo) unarrange(shell)
  }
  const gone = () => {
    if (shown === undo) shown = undefined
  }
  shown = undo
  toast("Arranged by Project", {
    id: ARRANGED,
    action: { label: "Undo", onClick: undo },
    onDismiss: gone,
    onAutoClose: gone,
  })
  return plan
}

/** Puts the workspaces back as they stood before the last Arrange by
 * Project, the Pane in front still in front, as Arrange brings it along;
 * a refusal, as they changed since, shows the engine's words. */
export function unarrange(shell: Pick<Shell, "change">): void {
  shown = undefined
  toast.dismiss(ARRANGED)
  shell.change((workspaces) => ({
    command: { method: "workspaces.unarrange", params: {} },
    want: focused(workspaces)?.id,
    refused: (error) => toast.error(problem(error, "Undo")),
  }))
}

/** Whether Undo's key is its own now: while the toast offers Undo, and
 * the focus is in no field or program, which have Ctrl+Z of their own. A
 * dialog keeps it as it keeps every key but the menu's own. */
export function undoesNow(): boolean {
  const at = document.activeElement
  const editing = at instanceof HTMLElement && at.isContentEditable
  return shown !== undefined && !editing && !at?.closest(OWN_UNDO)
}
