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

const UP_TO_DATE = "Branch is up to date. No action needed."

/** The button for `status`, with `writes` when a Harness is there to
 * write a commit's message: a new Thread's is not, till it starts. */
export function quickOf(
  status: Status,
  { writes }: { writes: boolean }
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
    if (!writes)
      return off(
        "Commit",
        "The Thread's Harness writes the message once the Thread has started.",
        "commit"
      )
    // Nowhere to push, or the push would be refused: commit alone.
    if (behind > 0 || (!upstream && !status.remote))
      return { label: "Commit", action: "commit", icon: "commit" }
    return { label: "Commit & push", action: "commit_push", icon: "push" }
  }
  if (!upstream) {
    if (!status.remote)
      return off("Push", 'Add an "origin" remote before pushing.', "push")
    // A branch never pushed: its commits are its own, if it has any.
    if (!status.head) return off("Push", "No local commits to push.", "push")
    return { label: "Push", action: "push", icon: "push" }
  }
  if (ahead > 0 && behind > 0)
    return off(
      "Sync branch",
      "Branch has diverged from upstream. Rebase or merge first.",
      "info"
    )
  if (behind > 0) return { label: "Pull", action: "pull", icon: "pull" }
  if (ahead > 0) return { label: "Push", action: "push", icon: "push" }
  return off("Commit", UP_TO_DATE, "commit")
}

/** Whether `action` on `status`'s branch asks first: a push on the
 * default branch does, a commit alone never. */
export function asksFirst(status: Status, action: Action): boolean {
  return (
    (action === "push" || action === "commit_push") &&
    status.branch !== undefined &&
    status.branch === status.default_branch
  )
}

/** What the default branch's question says, as T3 Code's. */
export function askOf(action: Action, branch: string) {
  const commits = action === "commit_push"
  return {
    title: commits ? `Commit & push to ${branch}?` : `Push to ${branch}?`,
    body: commits
      ? `This commits and pushes on “${branch}”. Or make a feature branch, named for the change, and do it there.`
      : `This pushes local commits on “${branch}”. Or make a feature branch yourself and push from it.`,
    go: commits ? `Commit & push to ${branch}` : `Push to ${branch}`,
  }
}
