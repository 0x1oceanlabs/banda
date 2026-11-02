import { describe, expect, it } from "vitest"
import { asked, viewOf, VIEW } from "./diff"
import { CHANGES, changeOf, isTest, labelOf } from "./scope"

describe("a scope", () => {
  it("is named on its button as T3 Code names it, a commit by its subject", () => {
    expect(labelOf(CHANGES)).toBe("Changes")
    expect(labelOf({ kind: "staged" })).toBe("Staged")
    expect(
      labelOf({ kind: "commit", sha: "abcdef1234", subject: "Fix it" })
    ).toBe("Fix it")
    expect(labelOf({ kind: "commit", sha: "abcdef1234", subject: "" })).toBe(
      "Commit abcdef1"
    )
  })

  it("is asked of the engine without the words only the Pane shows", () => {
    expect(asked(CHANGES)).toEqual({ kind: "changes" })
    expect(asked({ kind: "changes", base: "origin/main" })).toEqual({
      kind: "changes",
      base: "origin/main",
    })
    expect(asked({ kind: "commit", sha: "abc", subject: "Fix" })).toEqual({
      kind: "commit",
      sha: "abc",
    })
    expect(asked({ kind: "uncommitted" })).toEqual({ kind: "uncommitted" })
  })
})

describe("a file", () => {
  it("is tinted by how the patch says it changed", () => {
    expect(changeOf("new")).toBe("added")
    expect(changeOf("deleted")).toBe("deleted")
    expect(changeOf("rename-changed")).toBe("renamed")
    expect(changeOf("change")).toBe("modified")
  })

  it.each([
    "src/scope.test.ts",
    "app/e2e/window.spec.ts",
    "engine/tests/agents.rs",
    "pkg/run_test.go",
    "test_api.py",
    "conftest.py",
    "src/__snapshots__/view.snap",
    "src/__mocks__/fs.ts",
    "fixtures/repo.json",
    "src/api.mock.ts",
    "src/AppTests.swift",
  ])("%s is a test or a mock, which the Diff can hide", (path) => {
    expect(isTest(path)).toBe(true)
  })

  it.each([
    "src/scope.ts",
    "src/testing.md",
    "src/contest.ts",
    "pnpm-lock.yaml",
    "tests/generated/schema.ts",
    "dist/app.min.js",
  ])("%s is neither", (path) => {
    expect(isTest(path)).toBe(false)
  })
})

describe("the view", () => {
  it("starts as T3 Code's: stacked, wrapped, whitespace ignored, the tree shown", () => {
    expect(viewOf(undefined)).toEqual(VIEW)
    expect(VIEW).toMatchObject({
      layout: "stacked",
      wrap: true,
      ignoreWhitespace: true,
      tree: true,
    })
    expect(viewOf({ layout: "split" }).layout).toBe("split")
  })
})
