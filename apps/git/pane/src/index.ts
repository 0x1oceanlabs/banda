/** The git module's window part (ADR 0034): the Diff, the rows of a
 * Thread's details card, and its two keys, as T3 Code's. */
import { type Action, defineModule } from "@banda/ui/module"
import { PICKER } from "./BranchPicker"
import { diffOn, gitDetails } from "./Details"
import { diffPane } from "./DiffPane"
import { keepWindow } from "./ended"

/** T3 Code's Mod+D: the focused Pane's Project's Diff beside it, the one
 * shown if there is; on the Diff, it closes. Its Project is left to the
 * change, which finds the focused Pane where the last change left it, as
 * Mod+D pressed right after Alt+→. */
const toggleDiff: Action = {
  id: "git.diff",
  title: "Show the Diff, or hide it",
  section: "Git",
  keys: [{ code: "KeyD", mod: true }],
  run: (window) =>
    window.open(diffOn(), undefined, { again: false, toggle: true }),
}

/** T3 Code's Mod+Shift+G: the branch picker of the focused Thread's
 * card, the card shown first, as Threads' details action opens a part of
 * its rows. */
const switchBranch: Action = {
  id: "git.branch",
  title: "Switch branch",
  section: "Git",
  keys: [{ code: "KeyG", mod: true, shift: true }],
  run: (window) => window.run("agents.thread.details", { part: PICKER }),
}

export const git = defineModule({
  id: "git",
  engine: true,
  panes: [diffPane],
  actions: [toggleDiff, switchBranch],
  slots: [gitDetails],
  // What a card's run tells the Person, when no card is in sight.
  start: keepWindow,
})
