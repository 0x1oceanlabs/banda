import { beforeEach, expect, test, vi } from "vitest"
import type { Engine, ProjectId } from "@banda/contract"
import type { Here } from "@banda/ui/here"
import {
  cleanTitle,
  namingNow,
  startNaming,
  stopNaming,
} from "@banda/ui/lib/naming"
import type { Args, WindowApi } from "@banda/ui/module"
import type { Listed, Lists, PaneState } from "@banda/ui/pane"

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
const unread = vi.hoisted(() => [] as [string, boolean][])
vi.mock("./seen", () => ({
  markUnread: (id: string, on: boolean) => unread.push([id, on]),
}))

const { threadItems, suggestTitle } = await import("./items")

const S1 = "s1" as ProjectId

const listed = (more: Partial<Listed> = {}): Listed => ({
  id: "t1",
  title: "посмотри шапку pane",
  mark: "rest",
  changed: 1,
  pane: { kind: "agents.thread", args: {} },
  ...more,
})

/**
 * A Window whose lists hold `item` in Project s1, in focus, and whose
 * engines answer as an engine does: `agents.rename` names it,
 * `agents.suggest_title` suggests `title`. What each engine was asked, by
 * its host, it keeps, and what the Window was asked to run.
 */
function fake(item: Listed, title: string | Error = "") {
  const named: (string | null)[] = []
  const asked: { host: string | undefined; name: string }[] = []
  const ran: [string, Args | undefined][] = []
  const engineOf = (host: string | undefined) =>
    ({
      command: (name: string, args: { title?: string }) => {
        asked.push({ host, name })
        if (name === "agents.rename") {
          named.push(args.title ?? null)
          return Promise.resolve()
        }
        return title instanceof Error
          ? Promise.reject(title)
          : Promise.resolve(title)
      },
    }) as unknown as Engine
  const lists: Lists = { [S1]: [item] }
  const here = {
    pane: { id: "e1", project: S1, subject: item.id },
  } as Here
  const window = {
    here: { get: () => here, subscribe: () => () => undefined },
    items: { get: () => lists, subscribe: () => () => undefined },
    sessionOf: (_project: ProjectId, pane?: PaneState) =>
      engineOf(
        typeof pane?.args.host === "string" ? pane.args.host : undefined
      ),
    run: (action: string, args?: Args) => void ran.push([action, args]),
  } as unknown as WindowApi
  return { window, named, asked, ran, here }
}

const action = (id: string) => {
  const found = threadItems.find((one) => one.id === id)
  if (!found) throw new Error(`no ${id}`)
  return found
}

const AT = { now: 0, archived: false }

beforeEach(() => {
  said.toasts = []
  said.errors = []
  unread.length = 0
  stopNaming()
})

test("a field's title is one line, its ends trimmed; an empty one gives back the first message's", () => {
  expect(cleanTitle("  Fix \n the   list ")).toBe("Fix the list")
  const { window, named } = fake(listed())
  const rename = action("thread.rename")
  const at = { project: "s1", item: "t1" }
  rename.run(window, { ...at, title: " " })
  rename.run(window, { ...at, title: "Fix  the list" })
  // The title it has already: nothing to ask.
  rename.run(window, { ...at, title: "посмотри шапку pane " })
  expect(named).toEqual([null, "Fix the list"])
})

test("Rename with no title opens the field where it was asked; by its key, in the header", () => {
  const { window } = fake(listed())
  action("thread.rename").run(window, {
    project: "s1",
    item: "t1",
    from: "row",
  })
  expect(namingNow(S1, "t1")?.where).toBe("row")
  stopNaming()
  action("thread.rename").run(window)
  expect(namingNow(S1, "t1")?.where).toBe("head")
})

test("a Thread's Pane names it as `thread`, as it did before item actions", () => {
  const { window, named } = fake(listed())
  action("thread.rename").run(window, {
    project: "s1",
    thread: "t1",
    title: "Named",
  })
  expect(named).toEqual(["Named"])
})

test("Suggest renames in one press, and Undo gives back the first message's title", async () => {
  const { window, named } = fake(listed(), "Переименование треда")
  await suggestTitle(window, { project: S1, listed: listed() })
  expect(named).toEqual(["Переименование треда"])
  expect(said.toasts.map((toast) => toast.words)).toEqual([
    "Renamed to Переименование треда",
  ])
  said.toasts[0].undo?.()
  expect(named).toEqual(["Переименование треда", null])
})

test("Undo after a rename by hand gives back the Person's title", async () => {
  const item = listed({ title: "Flaky test", was: "fix flaky motion" })
  const { window, named } = fake(item, "Flaky motion.spec")
  await suggestTitle(window, { project: S1, listed: item })
  said.toasts[0].undo?.()
  expect(named).toEqual(["Flaky motion.spec", "Flaky test"])
})

test("a suggestion the title already says renames nothing", async () => {
  const item = listed({ title: "Flaky test" })
  const { window, named } = fake(item, "Flaky test")
  await suggestTitle(window, { project: S1, listed: item })
  expect(named).toEqual([])
  expect(said.toasts.map((toast) => toast.words)).toEqual([
    "The title already says it",
  ])
})

test("a suggestion refused says why", async () => {
  const { window } = fake(listed(), new Error("no model"))
  await suggestTitle(window, { project: S1, listed: listed() })
  expect(said.errors).toEqual(["Something went wrong. Try again."])
})

test("Shift+F2 with the field open puts the model's title in it, and renames nothing", async () => {
  const { window, named } = fake(listed(), "From the model")
  startNaming(S1, "t1", "head")
  action("thread.suggest-title").run(window)
  expect(namingNow(S1, "t1")?.asking).toBe(true)
  await vi.waitFor(() =>
    expect(namingNow(S1, "t1")?.offered).toEqual({
      title: "From the model",
      n: 1,
    })
  )
  expect(namingNow(S1, "t1")?.asking).toBe(false)
  expect(named).toEqual([])
})

test("another host's Thread is suggested a title and renamed on its own engine", async () => {
  const item = listed({
    pane: { kind: "agents.thread", args: { host: "arc" } },
  })
  const { window, asked } = fake(item, "There")
  action("thread.suggest-title").run(window, { project: "s1", item: "t1" })
  await vi.waitFor(() => expect(asked).toHaveLength(2))
  expect(asked).toEqual([
    { host: "arc", name: "agents.suggest_title" },
    { host: "arc", name: "agents.rename" },
  ])
})

test("by its key, another host's Thread asks no title: its header's menu does", () => {
  const item = listed({
    pane: { kind: "agents.thread", args: { host: "arc" } },
  })
  const { window, asked, here } = fake(item, "There")
  ;(here.pane as { host?: string }).host = "arc"
  action("thread.suggest-title").run(window)
  expect(asked).toEqual([])
})

test("Previous title gives back the one before; a Thread never renamed has no row", () => {
  const item = listed({ title: "Now", was: "Before" })
  const { window, named } = fake(item)
  const previous = action("agents.previous-title")
  expect(previous.row(listed(), AT)).toBeNull()
  expect(previous.row(item, AT)?.title).toBe("Previous title")
  previous.run(window, { project: "s1", item: "t1" })
  expect(named).toEqual(["Before"])
})

test("Mark as unread works both ways, and only on a Thread with a finished turn", () => {
  const mark = action("thread.unread")
  for (const seen of [true, false, undefined]) {
    const { window } = fake(listed({ seen }))
    mark.run(window, { project: "s1", item: "t1" })
  }
  expect(unread).toEqual([
    ["t1", true],
    ["t1", false],
  ])
  expect(mark.row(listed({ seen: true }), AT)?.title).toBe("Mark as unread")
  expect(mark.row(listed({ seen: false }), AT)?.title).toBe("Mark as read")
  expect(mark.row(listed(), AT)).toBeNull()
})

test("Make a Project is a row of a Thread in No Project alone, and the Window's dialog does it", () => {
  const make = action("agents.make-project")
  const scratch = { id: S1, scratch: true } as never
  expect(make.row(listed(), AT)).toBeNull()
  expect(make.row(listed(), { ...AT, project: scratch })?.title).toBe(
    "Make a Project from it…"
  )
  const { window, ran } = fake(listed())
  make.run(window, { project: "s1", item: "t1" })
  expect(ran).toEqual([["sidebar.make-project", { project: "s1" }]])
})

test("Threads acts on its own Items alone", () => {
  const item = listed({ pane: { kind: "files.file", args: {} } })
  const { window, named } = fake(item)
  action("thread.rename").run(window, {
    project: "s1",
    item: "t1",
    title: "x",
  })
  expect(named).toEqual([])
})
