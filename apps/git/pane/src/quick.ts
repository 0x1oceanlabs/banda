/**
 * The git button's one action (ADR 0034, decision 4), as T3 Code's
 * quick action (`GitActionsControl.logic.ts`): the first rule that fits
 * the status wins. Its pull request rules come with `pulls` (step 6).
 */
import type { Action, Status } from "@banda/contract/git"

export type Quick = {
  label: string
  /** What it runs; none when it is disabled. */
  action: Action | null
  /** It opens the Commit dialog first, rather than run at once. */
  asks?: boolean
  /** Why it is disabled, said on hover. */
  hint?: string
  icon: "commit" | "push" | "pull" | "info"
}

const off = (label: string, hint: string, icon: Quick["icon"]): Quick => ({
  label,
  action: null,
  hint,
  icon,
})

/** Why a commit cannot have its message written: the dialog's and the
 * run's say the same. */
export const NO_WRITER =
  "No agent is on to write the message. Write it yourself."

const UP_TO_DATE = "Branch is up to date. No action needed."
const DIVERGED = "Branch has diverged from upstream. Rebase or merge first."
const NO_COMMITS = "No local commits to push."

/** Whether `status`'s branch is the repository's default. */
export function onDefault(status: Status): boolean {
  return status.branch !== undefined && status.branch === status.default_branch
}

/** The button for `status`, with `started` once the Thread has: a new
 * Thread's Commit… opens the dialog, as nothing it said made the
 * changes. */
export function quickOf(
  status: Status,
  { started }: { started: boolean }
): Quick {
  if (!status.repo) return off("Commit", "Git status is unavailable.", "commit")
  if (!status.branch)
    return off(
      "Commit",
      "Check out a branch before committing and pushing.",
      "commit"
    )
  const ahead = status.ahead ?? 0
  const behind = status.behind ?? 0
  const upstream = status.upstream !== undefined
  if (status.files.length > 0) {
    if (!started)
      return { label: "Commit…", action: "commit", asks: true, icon: "commit" }
    // Nowhere to push, or the push would be refused: commit alone.
    if (behind > 0 || (!upstream && !status.remote))
      return { label: "Commit", action: "commit", icon: "commit" }
    return { label: "Commit & push", action: "commit_push", icon: "push" }
  }
  if (!upstream) {
    const { hint } = pushOf(status)
    if (hint) return off("Push", hint, "push")
    return { label: "Push", action: "push", icon: "push" }
  }
  if (ahead > 0 && behind > 0) return off("Sync branch", DIVERGED, "info")
  if (behind > 0) return { label: "Pull", action: "pull", icon: "pull" }
  if (ahead > 0) return { label: "Push", action: "push", icon: "push" }
  return off("Commit", UP_TO_DATE, "commit")
}

/** Whether `action` on `status`'s branch asks first: a push on the
 * default branch does, a commit alone never. */
export function asksFirst(status: Status, action: Action): boolean {
  return (action === "push" || action === "commit_push") && onDefault(status)
}

/** What the default branch's question says, as T3 Code's: a commit
 * may go on a new branch, named for the change; commits made already
 * have no change to name one for. */
export function askOf(
  action: Action,
  branch: string
): { title: string; body: string; go: string; branch?: string } {
  const commits = action === "commit_push"
  return {
    title: `You're on ${branch}`,
    body: commits
      ? `Push straight to ${branch}, or put this change on a new branch first?`
      : `Push your commits straight to ${branch}? To push them on a new branch, make it from the branch picker first.`,
    go: `Push to ${branch}`,
    ...(commits && { branch: "New branch & push" }),
  }
}

/** One item of the `▾` menu: whether it can run, and why not. */
export type Item = { can: boolean; hint?: string }

const CAN: Item = { can: true }
const no = (hint: string): Item => ({ can: false, hint })

/** Whether `status`'s branch can be pushed, and why not: the button's
 * Push and the menu's both ask it. */
function pushOf(status: Status): Item {
  if (!status.branch)
    return no("Detached HEAD: check out a branch before pushing.")
  if ((status.behind ?? 0) > 0)
    return no("Branch is behind upstream. Pull before pushing.")
  if (status.upstream === undefined) {
    if (!status.remote) return no('Add an "origin" remote before pushing.')
    // A branch never pushed: its commits past the default are its own,
    // if it has any; a branch just made has none.
    return status.head && status.ahead_of_default !== 0 ? CAN : no(NO_COMMITS)
  }
  return (status.ahead ?? 0) > 0 ? CAN : no(NO_COMMITS)
}

/** Whether `status`'s branch can be pulled, and why not: a branch
 * diverged cannot, as the button's Sync branch says. */
function pullOf(status: Status): Item {
  if (status.upstream === undefined)
    return no("The branch follows no upstream to pull from.")
  if ((status.behind ?? 0) === 0)
    return no("Branch is up to date with its upstream.")
  return (status.ahead ?? 0) > 0 ? no(DIVERGED) : CAN
}

/** The `▾` menu's items for `status`, as T3 Code's; and what Pull and
 * Push follow. Commit opens the dialog, which may write the message
 * itself, so it needs only changes. */
export function menuOf(status: Status): {
  commit: Item
  push: Item
  pull: Item
  follows?: string
} {
  return {
    commit:
      status.files.length > 0
        ? CAN
        : no("Worktree is clean. Make changes before committing."),
    push: pushOf(status),
    pull: pullOf(status),
    follows: status.upstream,
  }
}
