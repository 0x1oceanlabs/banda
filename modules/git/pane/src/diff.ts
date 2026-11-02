/**
 * What the Diff Pane reads and keeps, apart from how it draws it: the
 * scope as the engine is asked it, the files a cut patch left out, and the
 * Pane's choices. Pure, so plain tests cover it.
 */
import type { Scope as Asked } from "@banda/contract/git"
import type { Scope } from "./scope"

/** A scope git answers: all but a turn's, which the agents module does. */
export type GitScope = Exclude<Scope, { kind: "turn" }>

/** The scope as `git.diff` is asked it: a commit's subject stays here. */
export function asked(scope: GitScope): Asked {
  switch (scope.kind) {
    case "changes":
      return scope.base === null
        ? { kind: "changes" }
        : { kind: "changes", base: scope.base }
    case "commit":
      return { kind: "commit", sha: scope.sha }
    default:
      return { kind: scope.kind }
  }
}

/** How many files load at once after a cut patch, as T3 Code loads them. */
export const AT_ONCE = 4

/** How the Diff draws its files; the Pane keeps them in its args. */
export type View = {
  layout: "stacked" | "split"
  wrap: boolean
  /** Changes in whitespace alone are no changes. */
  ignoreWhitespace: boolean
  /** Test files and mocks are hidden. */
  hideTests: boolean
  /** The tree of files shows beside the changes. */
  tree: boolean
}

/** T3 Code's defaults: stacked, wrapped, whitespace ignored. */
export const VIEW: View = {
  layout: "stacked",
  wrap: true,
  ignoreWhitespace: true,
  hideTests: false,
  tree: true,
}

/** `view` read from args a Pane kept, its gaps filled from {@link VIEW}. */
export function viewOf(kept: Partial<View> | undefined): View {
  return { ...VIEW, ...kept }
}
