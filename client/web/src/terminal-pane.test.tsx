// @vitest-environment happy-dom
/**
 * The terminal Pane's first open (ADR 0106, decision 4; #1224): a Run line
 * is typed only into the shell its first open started, and one that fails
 * drops it; a Pane restored while its machine is away watches for its
 * shell, and hears it when the machine is back. The screen itself is
 * Ghostty's, which needs a canvas, and is a stand-in here.
 */
import { type Engine, type ProjectId, Unreachable } from "@banda/contract"
import type { PaneKind, PaneProps } from "@banda/ui/pane"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { modules } from "./modules"

/** The terminal's args, as its Pane keeps them (`TerminalArgs`). */
type TerminalArgs = {
  terminal: string | null
  title: string
  shell: boolean
  done: null
  typed?: string | null
}

const terminalPane = modules
  .flatMap((module) => module.panes ?? [])
  .find(
    (kind) => kind.kind === "terminal.terminal"
  ) as unknown as PaneKind<TerminalArgs>

const surfaces = vi.hoisted(() => {
  const made: {
    options: {
      onData: (data: string) => void
      onResize: (cols: number, rows: number) => void
      onLinkActivate: (text: string, event: { ctrlKey: boolean }) => void
      canActivateLink: (text: string) => boolean
    }
  }[] = []
  /** What the screens were given to draw, in order. */
  const drew: string[] = []
  /** What a screen answers to what it is given to draw, if anything. */
  const state: { answers: string | undefined } = { answers: undefined }
  class Surface {
    readonly cols = 80
    readonly rows = 24
    static create(_: unknown, options: never) {
      const one = new Surface()
      made.push({ options })
      return Promise.resolve(one)
    }
    setVisible() {}
    focus() {}
    fit() {}
    write(text: string) {
      drew.push(`write ${text}`)
      // A query in what it draws is answered at once, as Ghostty does.
      if (state.answers !== undefined)
        made.at(-1)?.options.onData(state.answers)
    }
    resetAndWrite(text: string) {
      drew.push(`screen ${text}`)
    }
    setSharedGrid() {}
    setFont() {}
    setTheme() {}
    setCursor() {}
    dispose() {}
    selectAll() {}
    getSelection() {
      return ""
    }
  }
  return Object.assign(state, { made, drew, Surface })
})
vi.mock("../../ghostty/src/index.ts", () => ({ Surface: surfaces.Surface }))

/** The machine as the Window shows it to the Pane, which the Pane reads as
 * its owner's status; none is this machine. */
const placed = vi.hoisted(() => ({
  now: {} as {
    host?: string
    shown?: { state: { state: string }; named: { name: string } }
  },
}))
vi.mock("../../core/src/react/index.ts", async (actual) => ({
  ...(await actual<object>()),
  usePlaced: () => placed.now,
}))

const AWAY = new Unreachable("arc", "arc is away")
const settle = () => act(() => new Promise<void>((done) => setTimeout(done, 0)))

/** An engine that notes what it is asked; `open` says how each
 * `terminal.open` ends. */
function engine(open: () => Promise<null>) {
  const calls: { method: string; params: unknown }[] = []
  const streams: {
    /** What it is asked with, now: as the session asks it again after a
     * reconnect. */
    params: () => unknown
    hear: (piece: unknown) => void
    end: (refusal?: { code: string; message: string }) => void
  }[] = []
  const session = {
    call: (method: string, params: unknown) => {
      calls.push({ method, params })
      return method === "terminal.open" ? open() : Promise.resolve(null)
    },
    stream: (
      _project: unknown,
      _method: string,
      params: unknown,
      hear: (piece: unknown) => void,
      end: (refusal?: { code: string; message: string }) => void
    ) => {
      streams.push({
        params: () => (typeof params === "function" ? params() : params),
        hear,
        end,
      })
      return () => {}
    },
    run: () => Promise.resolve(null),
    watch: () => () => {},
    status: { state: "open", boot: "b1" },
  } as unknown as Engine
  return { session, calls, streams }
}

/** `session` as it answers once its engine restarted: another boot. */
const restarted = (session: Engine) => {
  ;(session as unknown as { status: object }).status = {
    state: "open",
    boot: "b2",
  }
}

let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ""
  surfaces.made.length = 0
  surfaces.drew.length = 0
  placed.now = {}
})

/** The Pane mounted with `args` on `session`: `updated` hears each update,
 * which also draws it with the new args, as the window does. */
async function mount(
  session: Engine,
  args: TerminalArgs,
  handles: Partial<PaneProps<TerminalArgs>> = {}
) {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  const updated: TerminalArgs[] = []
  const element = document.createElement("div")
  document.body.append(element)
  root = createRoot(element)
  let now = args
  const draw = () =>
    root!.render(
      <terminalPane.Pane
        engine={session}
        project={"p" as ProjectId}
        args={now}
        focused
        open={() => {}}
        update={(next) => {
          updated.push(next)
          now = next
          draw()
        }}
        close={() => {}}
        {...handles}
      />
    )
  await act(async () => draw())
  await settle()
  await settle()
  return { updated, element, draw: () => act(async () => draw()) }
}

const NEW: TerminalArgs = {
  terminal: null,
  title: "Terminal",
  shell: true,
  done: null,
}

test("a Run line goes only into the shell its first open started", async () => {
  const { session, calls } = engine(() => Promise.resolve(null))
  const { updated } = await mount(session, { ...NEW, typed: "cargo test" })
  expect(calls.filter(({ method }) => method === "terminal.write")).toEqual([
    {
      method: "terminal.write",
      params: expect.objectContaining({ data: "cargo test\r" }),
    },
  ])
  expect(updated.at(-1)?.typed).toBeNull()
})

test("a Run line's first open refused as its machine is away drops it, and nothing types it later", async () => {
  let opens = 0
  const { session, calls, streams } = engine(() => {
    opens++
    return Promise.reject(AWAY)
  })
  const { updated } = await mount(session, { ...NEW, typed: "cargo test" })
  expect(opens).toBe(1)
  expect(calls.some(({ method }) => method === "terminal.write")).toBe(false)
  expect(updated.at(-1)?.typed).toBeNull()
  // It waits for the machine, a read, and the shell it hears takes no line.
  await act(async () =>
    streams[0]!.hear({
      kind: "snapshot",
      history: "",
      size: { cols: 80, rows: 24 },
    })
  )
  await settle()
  expect(calls.some(({ method }) => method === "terminal.write")).toBe(false)
})

test("a Pane restored with a line it never typed drops it: the restart was not its first open", async () => {
  const { session, calls } = engine(() => Promise.resolve(null))
  const { updated } = await mount(session, {
    ...NEW,
    terminal: "kept",
    typed: "cargo test",
  })
  expect(calls.some(({ method }) => method === "terminal.write")).toBe(false)
  expect(updated.at(-1)?.typed).toBeNull()
})

const SCREEN = {
  kind: "snapshot",
  history: "",
  size: { cols: 80, rows: 24 },
}

test("a shell gone under another boot of its engine says Ended, starts nothing by itself, and New shell here starts one", async () => {
  placed.now = {
    host: "arc",
    shown: { state: { state: "live" }, named: { name: "arc" } },
  }
  const { session, calls, streams } = engine(() => Promise.resolve(null))
  const { element } = await mount(session, NEW)
  await act(async () => streams[0]!.hear(SCREEN))
  const opens = () =>
    calls.filter(({ method }) => method === "terminal.open").length
  expect(opens()).toBe(1)

  restarted(session)
  await act(async () =>
    streams[0]!.end({ code: "not_found", message: "No such terminal." })
  )
  await settle()
  expect(opens()).toBe(1)
  expect(element.textContent).toContain("Ended: Banda restarted on arc")
  const button = [...element.querySelectorAll("button")].find(
    (one) => one.textContent === "New shell here"
  )
  expect(button).toBeDefined()

  await act(async () => button!.click())
  await settle()
  expect(opens()).toBe(2)
  await act(async () => streams[1]!.hear(SCREEN))
  expect(element.textContent).not.toContain("Ended")
})

test("on this machine it says only that Banda restarted", async () => {
  const { session, streams } = engine(() => Promise.resolve(null))
  const { element } = await mount(session, NEW)
  await act(async () => streams[0]!.hear(SCREEN))
  restarted(session)
  await act(async () =>
    streams[0]!.end({ code: "not_found", message: "No such terminal." })
  )
  await settle()
  expect(element.textContent).toContain("Ended: Banda restarted")
  expect(element.textContent).not.toContain("Ended: Banda restarted on")
})

test("a shell gone under the same boot starts again by itself, as it was closed there", async () => {
  const { session, calls, streams } = engine(() => Promise.resolve(null))
  const { element } = await mount(session, NEW)
  await act(async () => streams[0]!.hear(SCREEN))
  await act(async () =>
    streams[0]!.end({ code: "not_found", message: "No such terminal." })
  )
  await settle()
  expect(calls.filter(({ method }) => method === "terminal.open")).toHaveLength(
    2
  )
  expect(element.textContent).not.toContain("Ended")
})

test("on a new engine, its last having said goodbye, a shell gone under another boot says Ended and opens nothing", async () => {
  const first = engine(() => Promise.resolve(null))
  const handles: Partial<PaneProps<TerminalArgs>> = {}
  const { element, draw } = await mount(first.session, NEW, handles)
  await act(async () => first.streams[0]!.hear(SCREEN))
  const next = engine(() => Promise.resolve(null))
  restarted(next.session)
  handles.engine = next.session
  await draw()
  await settle()
  expect(next.calls.some(({ method }) => method === "terminal.open")).toBe(
    false
  )
  await act(async () =>
    next.streams[0]!.end({ code: "not_found", message: "No such terminal." })
  )
  await settle()
  expect(next.calls.some(({ method }) => method === "terminal.open")).toBe(
    false
  )
  expect(element.textContent).toContain("Ended: Banda restarted")
})

test("on a new engine of the same boot, the shell it finds runs on, and one it lost starts again", async () => {
  const first = engine(() => Promise.resolve(null))
  const handles: Partial<PaneProps<TerminalArgs>> = {}
  const { element, draw } = await mount(first.session, NEW, handles)
  await act(async () => first.streams[0]!.hear(SCREEN))
  const next = engine(() => Promise.resolve(null))
  handles.engine = next.session
  await draw()
  await settle()
  await act(async () => next.streams[0]!.hear(SCREEN))
  expect(element.textContent).not.toContain("Ended")
  await act(async () =>
    next.streams[0]!.end({ code: "not_found", message: "No such terminal." })
  )
  await settle()
  expect(
    next.calls.filter(({ method }) => method === "terminal.open")
  ).toHaveLength(1)
  expect(element.textContent).not.toContain("Ended")
})

test("a program gone under another boot says Ended too, and offers no shell", async () => {
  const { session, streams } = engine(() => Promise.resolve(null))
  const { element } = await mount(session, {
    ...NEW,
    terminal: "t",
    shell: false,
  })
  await act(async () => streams[0]!.hear(SCREEN))
  restarted(session)
  await act(async () =>
    streams[0]!.end({ code: "not_found", message: "No such terminal." })
  )
  await settle()
  expect(element.textContent).toContain("Ended: Banda restarted")
  expect(element.querySelector("button")).toBeNull()
})

test("a Pane restored while its machine is away watches its shell and, on the answer that it is kept, sends its own size", async () => {
  const { session, calls, streams } = engine(() => Promise.reject(AWAY))
  await mount(session, { ...NEW, terminal: "kept" })
  const sizes = () => calls.filter(({ method }) => method === "terminal.resize")
  // Its first size, refused for all it reached.
  await act(async () => surfaces.made[0]!.options.onResize(100, 40))
  await settle()
  expect(streams).toHaveLength(1)
  const before = sizes().length
  await act(async () =>
    streams[0]!.hear({
      kind: "snapshot",
      history: "",
      size: { cols: 80, rows: 24 },
    })
  )
  await settle()
  expect(sizes()).toHaveLength(before + 1)
  expect(sizes().at(-1)).toEqual({
    method: "terminal.resize",
    params: { terminal: "kept", size: { cols: 100, rows: 40 } },
  })
})

test("back after a reconnect, it asks for what came after what it drew, and draws no screen again", async () => {
  const { session, calls, streams } = engine(() => Promise.resolve(null))
  await mount(session, { ...NEW, terminal: "kept" })
  const watch = streams[0]!
  // Before it drew anything, it asks for the whole screen.
  expect(watch.params()).toEqual({ terminal: "kept" })
  const size = { cols: 80, rows: 24 }
  await act(async () => {
    watch.hear({
      kind: "snapshot",
      history: "$ ",
      size,
      in_order: true,
      drawn: { run: "r", at: 3 },
    })
    watch.hear({ kind: "output", text: "ls", at: 4 })
  })
  expect(surfaces.drew).toEqual(["screen $ ", "write ls"])
  // The connection breaks, and the session asks the stream again.
  expect(watch.params()).toEqual({
    terminal: "kept",
    after: { run: "r", at: 4 },
  })
  // The engine goes on from there: what it missed, and no screen. What
  // the screen answers to that old output is not typed.
  const typed = () => calls.filter(({ method }) => method === "terminal.write")
  surfaces.answers = "\u001b[?62;c"
  await act(async () =>
    watch.hear({
      kind: "resumed",
      missed: "\r\na.txt",
      at: 5,
      size,
      in_order: true,
    })
  )
  await settle()
  expect(surfaces.drew).toEqual(["screen $ ", "write ls", "write \r\na.txt"])
  expect(typed()).toEqual([])
  expect(watch.params()).toEqual({
    terminal: "kept",
    after: { run: "r", at: 5 },
  })
  // What it answers to output as it comes is typed, as ever.
  await act(async () => watch.hear({ kind: "output", text: "?", at: 6 }))
  await settle()
  expect(typed().map(({ params }) => params)).toEqual([
    { terminal: "kept", data: "\u001b[?62;c" },
  ])
  surfaces.answers = undefined
  // An engine older than that says no place: the whole screen each time.
  await act(async () => watch.hear({ kind: "snapshot", history: "$ ls", size }))
  expect(watch.params()).toEqual({ terminal: "kept" })
})

test("a Pane opened while its machine is away, back with no shell, offers one and types nothing", async () => {
  const { session, streams } = engine(() => Promise.reject(AWAY))
  const { element } = await mount(session, NEW)
  await act(async () =>
    streams[0]!.end({ code: "not_found", message: "This terminal is gone" })
  )
  await settle()
  expect(element.textContent).toContain("This terminal has no shell yet.")
  expect(element.textContent).toContain("Start a shell")
})

test("a key while its machine is away says it was not sent, with the honest note", async () => {
  const { session } = engine(() => Promise.reject(AWAY))
  const { element } = await mount(session, {
    ...NEW,
    terminal: "kept" as never,
  })
  ;(session as unknown as { call: () => Promise<never> }).call = () =>
    Promise.reject(AWAY)
  await act(async () => surfaces.made[0]!.options.onData("x"))
  await settle()
  expect(element.textContent).toContain(
    "arc is away: your typing was not sent."
  )
  expect(element.querySelector("[title]")?.getAttribute("title")).toBe(
    "What was typed before arc went away may still arrive once it is back."
  )
})

const REFUSED = "arc is away: your typing was not sent."

test("a key refused in a stall stops being said once its machine is heard again, with no snapshot", async () => {
  placed.now = {
    host: "arc",
    shown: { state: { state: "away" }, named: { name: "arc" } },
  }
  const { session } = engine(() => Promise.reject(AWAY))
  const { element, draw } = await mount(session, { ...NEW, terminal: "kept" })
  ;(session as unknown as { call: () => Promise<never> }).call = () =>
    Promise.reject(AWAY)
  await act(async () => surfaces.made[0]!.options.onData("x"))
  await settle()
  expect(element.textContent).toContain(REFUSED)
  placed.now = {
    host: "arc",
    shown: { state: { state: "live" }, named: { name: "arc" } },
  }
  await draw()
  await settle()
  expect(element.textContent).not.toContain(REFUSED)
})

test("a key pressed while parked is no longer said once its machine answers there is no shell", async () => {
  const { session, streams } = engine(() => Promise.reject(AWAY))
  const { element } = await mount(session, NEW)
  ;(session as unknown as { call: () => Promise<never> }).call = () =>
    Promise.reject(AWAY)
  await act(async () => surfaces.made[0]!.options.onData("x"))
  await settle()
  expect(element.textContent).toContain(REFUSED)
  await act(async () =>
    streams[0]!.end({ code: "not_found", message: "This terminal is gone" })
  )
  await settle()
  expect(element.textContent).not.toContain(REFUSED)
  expect(element.textContent).toContain("Start a shell")
})

test("Start a shell, refused, names what the Person pressed", async () => {
  const { session, streams } = engine(() => Promise.reject(AWAY))
  const { element } = await mount(session, NEW)
  await act(async () =>
    streams[0]!.end({ code: "not_found", message: "This terminal is gone" })
  )
  await settle()
  await act(async () =>
    [...element.querySelectorAll("button")]
      .find((button) => button.textContent === "Start a shell")!
      .click()
  )
  await settle()
  expect(element.textContent).toContain("Start a shell was not sent.")
})

test("a Pane closed while its first open waits types no line and watches nothing", async () => {
  let opened = () => {}
  const { session, calls, streams } = engine(
    () => new Promise((done) => (opened = () => done(null)))
  )
  await mount(session, { ...NEW, typed: "cargo test" })
  await act(async () => root?.unmount())
  root = undefined
  await act(async () => opened())
  await settle()
  expect(calls.some(({ method }) => method === "terminal.write")).toBe(false)
  expect(streams).toHaveLength(0)
})

test("a page link leaves the Pane only as the router's act, and with no window it opens nothing", async () => {
  const opens = vi.spyOn(window, "open").mockReturnValue(null)
  const run = vi.fn()
  const { session } = engine(() => Promise.resolve(null))
  await mount(
    session,
    { ...NEW, terminal: "kept" },
    {
      run,
      runs: (what) =>
        what === "link.open" ? { runs: true } : { runs: false, why: "no" },
    }
  )
  const url = "https://example.test/"
  surfaces.made[0]!.options.onLinkActivate(url, { ctrlKey: false })
  expect(run.mock.calls).toEqual([["link.open", { url }]])
  surfaces.made.length = 0
  surfaces.drew.length = 0
  await act(async () => root?.unmount())
  await mount(session, { ...NEW, terminal: "kept" })
  surfaces.made[0]!.options.onLinkActivate(url, { ctrlKey: false })
  expect(opens).not.toHaveBeenCalled()
  opens.mockRestore()
})
