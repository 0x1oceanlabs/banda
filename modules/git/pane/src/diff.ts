/**
 * What the Diff Pane reads and keeps, apart from how it draws it: the
 * scope as the engine is asked it, the files a cut patch left out, and the
 * Pane's choices. Pure, so plain tests cover it.
 */
import type { Scope as Asked } from "@banda/contract/git"
import type { Scope } from "./scope"

/** The scope as `git.diff` is asked it: a commit's subject and a turn's
 * title stay here. */
export function asked(scope: Scope): Asked {
  switch (scope.kind) {
    case "changes":
      return scope.base === null
        ? { kind: "changes" }
        : { kind: "changes", base: scope.base }
    case "commit":
      return { kind: "commit", sha: scope.sha }
    case "turn":
      return { kind: "turn", thread: scope.thread, turn: scope.turn }
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

/** T3 Code's defaults: stacked, wrapped, whitespace ignored; the tree
 * as wide a Pane has room for it. */
const VIEW: Omit<View, "tree"> = {
  layout: "stacked",
  wrap: true,
  ignoreWhitespace: true,
  hideTests: false,
}

/** `view` read from args a Pane kept, its gaps filled from {@link VIEW};
 * the tree, unless it was chosen, shown when the Pane is `wide`. */
export function viewOf(kept: Partial<View> | undefined, wide = true): View {
  return { ...VIEW, tree: wide, ...kept }
}
