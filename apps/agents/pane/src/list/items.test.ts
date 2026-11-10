import { beforeEach, expect, test, vi } from "vitest"
import { type Engine, Lost, type ProjectId, Refused } from "@banda/contract"
import { type Here, Unreachable } from "@banda/core/react"
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
const { threadItems, suggestTitle } = await import("./items")
const { sendingTo } = await import("./sent")

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
  const sent: [string, unknown][] = []
  const ran: [string, Args | undefined][] = []
  const command = (host: string | undefined) => {
    return (name: string, args: { title?: string }) => {
      asked.push({ host, name })
      sent.push([name, args])
      if (name === "agents.rename") {
        named.push(args.title ?? null)
        return Promise.resolve()
      }
      return title instanceof Error
        ? Promise.reject(title)
        : Promise.resolve(title)
    }
  }
  // One engine for each host, as the Window keeps them.
  const engines = new Map<string | undefined, Engine>()
  const engineOf = (host: string | undefined) => {
    const kept = engines.get(host)
    if (kept) return kept
    const asks = command(host)
    const engine = {
      status: { state: "open" },
      watch: () => () => undefined,
      command: asks,
      // As the engine sends a command `once`: refused at once while it is
      // not open, and never sent.
      commandAt: (
        name: string,
        args: { title?: string },
        _project?: ProjectId,
        _command?: string,
        options?: { once?: boolean }
      ) =>
        options?.once && engine.status.state !== "open"
          ? Promise.reject(new Lost())
          : asks(name, args).then((answer) => ({ answer, at: 3 })),
    } as unknown as Engine
    engines.set(host, engine)
    return engine
  }
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
  return { window, named, asked, sent, ran, here, engineOf }
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

test("by its key, another host's Thread is suggested a title on its own engine, as from its header's menu: keys share the router (ADR 0106, law 3)", async () => {
  const item = listed({
    pane: { kind: "agents.thread", args: { host: "arc" } },
  })
  const { window, asked, here } = fake(item, "There")
  ;(here.pane as { host?: string }).host = "arc"
  action("thread.suggest-title").run(window)
  await vi.waitFor(() => expect(asked).toHaveLength(2))
  expect(asked).toEqual([
    { host: "arc", name: "agents.suggest_title" },
    { host: "arc", name: "agents.rename" },
  ])
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

test("Mark as unread works both ways, on the Thread's host, and only on a Thread with a finished turn", () => {
  const mark = action("thread.unread")
  const at = { project: "s1", item: "t1" }
  const sent = [true, false, undefined].flatMap((seen) => {
    const one = fake(listed({ seen }))
    mark.run(one.window, at)
    return one.sent
  })
  expect(sent).toEqual([
    ["agents.unread", { thread: "t1" }],
    // Read: the latest turn that ended, as the host knows it.
    ["agents.read", { thread: "t1" }],
  ])
  expect(mark.row(listed({ seen: true }), AT)?.title).toBe("Mark as unread")
  expect(mark.row(listed({ seen: false }), AT)?.title).toBe("Mark as read")
  expect(mark.row(listed(), AT)).toBeNull()

  // Another host's Thread is marked on its engine, never on this one's.
  const arc = fake(
    listed({
      seen: true,
      pane: { kind: "agents.thread", args: { host: "arc" } },
    })
  )
  mark.run(arc.window, at)
  expect(arc.asked).toEqual([{ host: "arc", name: "agents.unread" }])
  expect(sendingTo(arc.engineOf("arc")).t1?.seen?.to).toBeNull()
  expect(sendingTo(arc.engineOf(undefined))).toEqual({})
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
  expect(ran).toEqual([["project.make", { project: "s1" }]])
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

test("Later with a time puts it off at once, puts the Thread away, and Undo wakes it", async () => {
  const { window, sent, ran } = fake(listed({ mark: "running" }))
  const at = { project: "s1", item: "t1" }
  action("thread.later").run(window, { ...at, until: 5_000, resume: true })
  await vi.waitFor(() => expect(said.toasts).toHaveLength(1))
  expect(sent).toEqual([
    ["agents.later", { thread: "t1", until: 5_000, resume: true }],
  ])
  expect(ran).toEqual([["pane.put-away", at]])
  expect(said.toasts[0].words).toMatch(/^Later, until /)
  said.toasts[0].undo?.()
  expect(sent.at(-1)).toEqual(["agents.wake", { thread: "t1" }])
})

test("Later till its turn ends sends no time", async () => {
  const { window, sent } = fake(listed({ mark: "running" }))
  action("thread.later").run(window, { project: "s1", item: "t1", done: true })
  await vi.waitFor(() =>
    expect(said.toasts.map((toast) => toast.words)).toEqual([
      "Later, until it's done",
    ])
  )
  expect(sent).toEqual([["agents.later", { thread: "t1" }]])
})

test("Later asked for no time opens the Window's picker, for the Thread named or the one in focus", () => {
  const { window, sent, ran } = fake(listed())
  action("thread.later").run(window)
  action("thread.later").run(window, { project: "s1", item: "t1" })
  expect(sent).toEqual([])
  expect(ran).toEqual([
    ["sidebar.later-picker", { project: "s1", item: "t1" }],
    ["sidebar.later-picker", { project: "s1", item: "t1" }],
  ])
})

test("Wake now wakes it; what the engine refuses, a toast says", async () => {
  const { window, sent } = fake(listed())
  action("thread.wake").run(window, { project: "s1", item: "t1" })
  expect(sent).toEqual([["agents.wake", { thread: "t1" }]])
  // An engine that refuses all but a rename.
  const refused = fake(listed(), new Error("no"))
  action("thread.wake").run(refused.window, { project: "s1", item: "t1" })
  await vi.waitFor(() => expect(said.errors).toHaveLength(1))
})

test("another host's Thread is put off and woken on its own engine", async () => {
  const item = listed({
    pane: { kind: "agents.thread", args: { host: "arc" } },
  })
  const { window, asked } = fake(item)
  action("thread.later").run(window, { project: "s1", item: "t1", until: 9 })
  action("thread.wake").run(window, { project: "s1", item: "t1" })
  await vi.waitFor(() => expect(said.toasts).toHaveLength(1))
  expect(asked).toEqual([
    { host: "arc", name: "agents.later" },
    { host: "arc", name: "agents.wake" },
  ])
})

test("Later… is off while the Thread asks, and Wake now takes its place while it sleeps", () => {
  const later = action("thread.later")
  const wake = action("thread.wake")
  const sleeping = listed({ later: { at: 0, until: 100 } })
  expect(later.row(listed(), AT)).toMatchObject({ title: "Later…" })
  expect(later.row(listed(), AT)?.off).toBeUndefined()
  expect(later.row(listed({ mark: "asking" }), AT)?.off).toBe(true)
  expect(later.row(sleeping, AT)).toBeNull()
  expect(wake.row(sleeping, AT)?.title).toBe("Wake now")
  expect(wake.row(sleeping, { ...AT, now: 100 })).toBeNull()
  expect(wake.row(listed(), AT)).toBeNull()
})

/**
 * A Window as `fake` makes it, whose engine holds each command until the
 * test answers it or refuses it, as a far host's answer comes late.
 */
function held(item: Listed) {
  const one = fake(item)
  const waiting: { answer: () => void; refuse: (error: Error) => void }[] = []
  const engine = one.engineOf(undefined)
  Object.assign(engine, {
    commandAt: (name: string, args: unknown) => {
      one.sent.push([name, args])
      return new Promise((resolve, reject) =>
        waiting.push({
          answer: () => resolve({ answer: null, at: 3 }),
          refuse: reject,
        })
      )
    },
  })
  /** Whatever the answers start, as their `then`s run. */
  const heard = () => new Promise((resolve) => setTimeout(resolve))
  return { ...one, engine, waiting, heard }
}

test("Archive goes to the Thread's host with what the sidebar list asks, and puts the Thread away at once", async () => {
  const archive = action("agents.archive-thread")
  expect(archive.row(listed(), AT)).toBeNull()
  const at = { project: "s1", item: "t1" }
  const { window, sent, ran } = fake(listed())
  archive.run(window, { ...at, archived: true })
  expect(sent).toEqual([["agents.archive", { thread: "t1" }]])
  expect(ran).toEqual([["pane.put-away", at]])
  archive.run(window, { ...at, archived: false })
  expect(sent.at(-1)).toEqual(["agents.unarchive", { thread: "t1" }])
  // Asked for neither, it does nothing.
  archive.run(window, at)
  expect(sent).toHaveLength(2)
  await Promise.resolve()
  expect(ran).toHaveLength(1)
})

test("Archive puts the Thread away on the press, and its answer, however late, closes nothing (#974)", async () => {
  const archive = action("agents.archive-thread")
  const at = { project: "s1", item: "t1" }

  // Brought back before the host answered: its Panes, opened again, stay.
  const back = held(listed())
  archive.run(back.window, { ...at, archived: true })
  expect(back.ran).toEqual([["pane.put-away", at]])
  archive.run(back.window, { ...at, archived: false })
  back.waiting[0]!.answer()
  back.waiting[1]!.answer()
  await back.heard()
  expect(back.ran).toEqual([["pane.put-away", at]])

  // Opened from Archive before the host answered: its answer puts
  // nothing away, so that Pane stays.
  const opened = held(listed())
  archive.run(opened.window, { ...at, archived: true })
  expect(opened.ran).toEqual([["pane.put-away", at]])
  opened.waiting[0]!.answer()
  await opened.heard()
  expect(opened.ran).toEqual([["pane.put-away", at]])
  expect(said.errors).toEqual([])
})

test("an archive its host refuses, or whose host goes, comes back in the list with a toast; its Panes stay closed", async () => {
  const at = { project: "s1", item: "t1" }
  for (const error of [new Error("at work"), new Lost()]) {
    said.errors = []
    const { window, ran, engine, waiting, heard } = held(listed())
    action("agents.archive-thread").run(window, { ...at, archived: true })
    expect(sendingTo(engine).t1?.archived?.to).toBe(true)
    expect(ran).toEqual([["pane.put-away", at]])
    waiting[0]!.refuse(error)
    await vi.waitFor(() => expect(said.errors).toHaveLength(1))
    await heard()
    // Shown as its host lists it again, and nothing opens its Panes.
    expect(sendingTo(engine)).toEqual({})
    expect(ran).toEqual([["pane.put-away", at]])
  }
})

test("an archive whose host is away is not sent, and keeps the Thread's Panes, with a toast", async () => {
  const { window, sent, ran, engineOf } = fake(listed())
  Object.assign(engineOf(undefined), { status: { state: "lost" } })
  action("agents.archive-thread").run(window, {
    project: "s1",
    item: "t1",
    archived: true,
  })
  await vi.waitFor(() => expect(said.errors).toHaveLength(1))
  expect(sent).toEqual([])
  expect(ran).toEqual([])
})

test("Delete goes to the Thread's host for the Thread it names, and puts it away once the host took it", async () => {
  const remove = action("agents.delete-thread")
  expect(remove.row(listed(), AT)).toBeNull()
  const at = { project: "s1", item: "t1" }
  const { window, sent, ran } = fake(listed())
  // Never the one in focus: a delete is never a guess.
  remove.run(window)
  remove.run(window, { project: "s1" })
  expect(sent).toEqual([])
  remove.run(window, at)
  expect(sent).toEqual([["agents.delete", { thread: "t1" }]])
  expect(ran).toEqual([])
  await vi.waitFor(() => expect(ran).toEqual([["pane.put-away", at]]))
  expect(said.errors).toEqual([])
})

test("a delete its host refuses keeps the Thread's Panes with a toast, and one whose host is away is not sent", async () => {
  const at = { project: "s1", item: "t1" }
  const refusal = { code: "conflict", message: "This Thread is at work." }
  const refused = fake(listed(), new Refused(refusal as never))
  action("agents.delete-thread").run(refused.window, at)
  await vi.waitFor(() =>
    expect(said.errors).toEqual(["This Thread is at work."])
  )
  expect(refused.ran).toEqual([])

  said.errors = []
  const { window, sent, ran, engineOf } = fake(listed())
  Object.assign(engineOf(undefined), { status: { state: "lost" } })
  action("agents.delete-thread").run(window, at)
  await vi.waitFor(() => expect(said.errors).toHaveLength(1))
  expect(sent).toEqual([])
  expect(ran).toEqual([])
})

test("another host's Thread is deleted on its own engine", () => {
  const item = listed({
    pane: { kind: "agents.thread", args: { host: "arc" } },
  })
  const { window, asked } = fake(item)
  action("agents.delete-thread").run(window, { project: "s1", item: "t1" })
  expect(asked).toEqual([{ host: "arc", name: "agents.delete" }])
})

test("another host's Thread is archived on its own engine", () => {
  const item = listed({
    pane: { kind: "agents.thread", args: { host: "arc" } },
  })
  const { window, asked } = fake(item)
  action("agents.archive-thread").run(window, {
    project: "s1",
    item: "t1",
    archived: true,
  })
  expect(asked).toEqual([{ host: "arc", name: "agents.archive" }])
})

test("another host's Thread the Window does not reach now is renamed, put off to Later, woken, marked, archived and deleted nowhere: each is refused at once, in that host's words, and its Panes stay", async () => {
  const item = listed({
    seen: true,
    pane: { kind: "agents.thread", args: { host: "arc" } },
  })
  const { window, asked, ran } = fake(item)
  const away = Object.assign(window, {
    sessionOf: () => {
      throw new Unreachable("arc", "arc is away")
    },
  })
  const at = { project: "s1", item: "t1" }
  action("thread.rename").run(away, { ...at, title: "New" })
  action("thread.later").run(away, { ...at, until: 9 })
  action("thread.wake").run(away, at)
  action("thread.unread").run(away, at)
  action("agents.archive-thread").run(away, { ...at, archived: true })
  action("agents.delete-thread").run(away, at)
  await vi.waitFor(() => expect(said.errors).toHaveLength(6))
  // Each names the machine and what was not sent.
  expect(new Set(said.errors)).toEqual(
    new Set([
      "arc is away: Rename was not sent.",
      "arc is away: Later was not sent.",
      "arc is away: Wake now was not sent.",
      "arc is away: Mark as unread was not sent.",
      "arc is away: Archive was not sent.",
      "arc is away: Delete was not sent.",
    ])
  )
  expect(asked).toEqual([])
  expect(ran).toEqual([])
})
