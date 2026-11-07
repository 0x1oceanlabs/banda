/**
 * What a Diff compares, as T3 Code's scope menu names it, and the Codex
 * app's Staged (ADR 0034, decision 2). Pure, so plain tests cover it.
 */
import type { GitStatus } from "@banda/ui/components/file-tree"

/** What the Diff compares: the branch against its base (`base` none for
 * where it left the default branch), the work tree, the index, or one
 * commit. */
export type Scope =
  | { kind: "changes"; base: string | null }
  | { kind: "uncommitted" }
  /** The work tree against the index: what is not staged yet. */
  | { kind: "unstaged" }
  | { kind: "staged" }
  | { kind: "commit"; sha: string; subject: string }
  /** What one turn of a Thread changed: from its checkpoints, or from
   * its tool calls where git kept none; `title` is the start of the
   * message that asked for it. */
  | { kind: "turn"; thread: string; turn: string; title: string }

export const CHANGES: Extract<Scope, { kind: "changes" }> = {
  kind: "changes",
  base: null,
}

/** The words on the scope menu's button. */
export function labelOf(scope: Scope): string {
  switch (scope.kind) {
    case "changes":
      return "Changes"
    case "uncommitted":
      return "Uncommitted"
    case "unstaged":
      return "Unstaged"
    case "staged":
      return "Staged"
    case "commit":
      return scope.subject || `Commit ${scope.sha.slice(0, 7)}`
    case "turn":
      return scope.title || "Turn"
  }
}

/** A file's change from what the patch says of it. */
export function changeOf(
  type: "change" | "rename-pure" | "rename-changed" | "new" | "deleted"
): GitStatus {
  switch (type) {
    case "new":
      return "added"
    case "deleted":
      return "deleted"
    case "rename-pure":
    case "rename-changed":
      return "renamed"
    case "change":
      return "modified"
  }
}

/** A test file or a mock, which the Diff can hide, by T3 Code's rules
 * (`packages/shared/src/changedFileKind.ts`); a lockfile, a minified file
 * or one under `generated/` is neither. */
export function isTest(path: string): boolean {
  const parts = path.split("/")
  const name = parts.at(-1) ?? ""
  const folders = parts.slice(0, -1)
  if (GENERATED.test(path)) return false
  return (
    TEST_NAME.test(name) ||
    TEST_CLASS.test(name) ||
    MOCK_NAME.test(name) ||
    folders.some(
      (folder) => TEST_FOLDERS.has(folder) || MOCK_FOLDERS.has(folder)
    )
  )
}

const GENERATED =
  /(^|\/)generated\/|\.min\.[^./]+$|(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock|bun\.lockb?|go\.sum|poetry\.lock|uv\.lock)$/
const TEST_NAME =
  /(\.(test|spec|e2e|eval)\.[^.]+$|_(test|spec)\.[^.]+$|^test_.+\.py$|^conftest\.py$|^(vitest|jest)\.setup\.[^.]+$)/i
const TEST_CLASS = /(Tests?|Spec)\.(java|kt|kts|scala|groovy|cs|php|swift|m)$/
const MOCK_NAME =
  /(\.snap$|\.(mocks?|fixtures?|stubs?|fakes?)\.[^.]+$|^(mocks?|fixtures?|stubs?|fakes?)([-_.A-Z]|$))/
const TEST_FOLDERS = new Set([
  "__tests__",
  "__test__",
  "cypress",
  "e2e",
  "evals",
  "spec",
  "specs",
  "test",
  "tests",
])
const MOCK_FOLDERS = new Set([
  "__fixtures__",
  "__mocks__",
  "__snapshots__",
  "fakes",
  "fixture",
  "fixtures",
  "mock",
  "mocks",
  "stubs",
  "testdata",
])
