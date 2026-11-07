import { beforeEach, expect, test, vi } from "vitest"
import type { Engine } from "@banda/contract"
import type { Listing } from "@banda/ui/module"
import type { Listed } from "@banda/ui/pane"

const said = vi.hoisted(() => ({
  toasts: [] as { words: string; undo?: () => void }[],
  errors: [] as string[],
}))
vi.mock("@banda/ui/components/sonner", () => ({
  toast: Object.assign(
    (words: string, more?: { action?: { onClick: () => void } }) =>
      said.toasts.push({ words, undo: more?.action?.onClick }),
    { error: (words: string) => said.errors.push(words) }
  ),
}))
const listing = vi.hoisted(() => ({ current: undefined as unknown }))
vi.mock("../registry", () => ({ listingOf: () => listing.current }))

const { cleanTitle, renameTo, suggestTitle, toggleUnread } =
  await import("./titles")

const engine = {} as Engine
const listed = (more: Partial<Listed> = {}): Listed => ({
  id: "t1",
  title: "посмотри шапку pane",
  mark: "rest",
  changed: 1,
  pane: { kind: "agents.thread", args: {} },
  ...more,
})

/** A module that names its things as `named` says, and suggests `title`. */
function fake(title: string) {
  const named: (string | null)[] = []
  const unread: [string, boolean][] = []
  listing.current = {
    rename: (_engine, _project, _id, title) => {
      named.push(title)
      return Promise.resolve()
    },
    suggest: () => Promise.resolve(title),
    unread: (id, on) => unread.push([id, on]),
  } satisfies Listing
  return { named, unread }
}

beforeEach(() => {
  said.toasts = []
  said.errors = []
})

test("a field's title is one line, its projects trimmed; an empty one gives back the first message's", () => {
  expect(cleanTitle("  Fix \n the   list ")).toBe("Fix the list")
  const { named } = fake("")
  renameTo(engine, "s1", listed(), " ")
  renameTo(engine, "s1", listed(), "Fix  the list")
  // The title it has already: nothing to ask.
  renameTo(engine, "s1", listed(), "посмотри шапку pane ")
  expect(named).toEqual([null, "Fix the list"])
})

test("Suggest renames in one press, and Undo gives back the first message's title", async () => {
  const { named } = fake("Переименование треда")
  await suggestTitle(engine, "s1", listed())
  expect(named).toEqual(["Переименование треда"])
  expect(said.toasts.map((toast) => toast.words)).toEqual([
    "Renamed to Переименование треда",
  ])
  said.toasts[0].undo?.()
  expect(named).toEqual(["Переименование треда", null])
})

test("Undo after a rename by hand gives back the Person's title", async () => {
  const { named } = fake("Flaky motion.spec")
  await suggestTitle(
    engine,
    "s1",
    listed({ title: "Flaky test", was: "fix flaky motion" })
  )
  said.toasts[0].undo?.()
  expect(named).toEqual(["Flaky motion.spec", "Flaky test"])
})

test("a suggestion the title already says renames nothing", async () => {
  const { named } = fake("Flaky test")
  await suggestTitle(engine, "s1", listed({ title: "Flaky test" }))
  expect(named).toEqual([])
  expect(said.toasts.map((toast) => toast.words)).toEqual([
    "The title already says it",
  ])
})

test("a suggestion refused says why", async () => {
  fake("")
  ;(listing.current as Listing).suggest = () =>
    Promise.reject(new Error("no model"))
  await suggestTitle(engine, "s1", listed())
  expect(said.errors).toEqual(["Something went wrong. Try again."])
})

test("Mark as unread works both ways, and only on a Thread with a finished turn", () => {
  const { unread } = fake("")
  toggleUnread(listed({ seen: true }))
  toggleUnread(listed({ seen: false }))
  toggleUnread(listed())
  expect(unread).toEqual([
    ["t1", true],
    ["t1", false],
  ])
})
