// @vitest-environment happy-dom
/**
 * The terminal Pane's first open (ADR 0106, decision 4; #1224): a Run line
 * is typed only into the shell its first open started, and one that fails
 * drops it; a Pane restored while its machine is away watches for its
 * shell, and hears it when the machine is back. The screen itself is
 * Ghostty's, which needs a canvas, and is a stand-in here.
 */
import { type Engine, type ProjectId, Unreachable } from "@banda/contract"
import type { PaneProps } from "@banda/ui/pane"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { terminalPane, type TerminalArgs } from "@banda/terminal-pane"

const surfaces = vi.hoisted(() => {
  const made: {
    options: {
      onData: (data: string) => void
      onResize: (cols: number, rows: number) => void
    }
  }[] = []
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
    write() {}
    resetAndWrite() {}
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
  return { made, Surface }
})
vi.mock("../../ghostty/src/index.ts", () => ({ Surface: surfaces.Surface }))

const AWAY = new Unreachable("arc", "arc is away")
const settle = () => act(() => new Promise<void>((done) => setTimeout(done, 0)))

/** An engine that notes what it is asked; `open` says how each
 * `terminal.open` ends. */
function engine(open: () => Promise<null>) {
  const calls: { method: string; params: unknown }[] = []
  const streams: {
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
      _params: unknown,
      hear: (piece: unknown) => void,
      end: (refusal?: { code: string; message: string }) => void
    ) => {
      streams.push({ hear, end })
      return () => {}
    },
    run: () => Promise.resolve(null),
    watch: () => () => {},
  } as unknown as Engine
  return { session, calls, streams }
}

let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ""
  surfaces.made.length = 0
})

/** The Pane mounted with `args` on `session`: `updated` hears each update,
 * which also draws it with the new args, as the window does. */
async function mount(session: Engine, args: TerminalArgs) {
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
        {...({} as Partial<PaneProps<TerminalArgs>>)}
      />
    )
  await act(async () => draw())
  await settle()
  await settle()
  return { updated, element }
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
    terminal: "kept" as never,
    typed: "cargo test",
  })
  expect(calls.some(({ method }) => method === "terminal.write")).toBe(false)
  expect(updated.at(-1)?.typed).toBeNull()
})

test("a Pane restored while its machine is away watches its shell and, on the answer that it is kept, sends its own size", async () => {
  const { session, calls, streams } = engine(() => Promise.reject(AWAY))
  await mount(session, { ...NEW, terminal: "kept" as never })
  const sizes = () =>
    calls.filter(({ method }) => method === "terminal.resize")
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
