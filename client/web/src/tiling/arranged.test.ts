// @vitest-environment happy-dom
import { newId, Refused } from "@banda/contract"
import { expect, test, vi } from "vitest"
import { arranging, TILING_ACTIONS, type Tiling } from "./actions"
import {
  type Change,
  keptOf,
  NO_VIEW,
  type Plan,
  resolve,
  type Step,
} from "./arrange"
import { undoesNow } from "./arranged"
import { apply } from "./arrangement"
import { focused, open, start, type Workspaces } from "./model"
import { placingOf } from "./opening"

// What the toasts were told.
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() })
)
vi.mock("@banda/ui/components/sonner", () => ({ toast }))

const row = placingOf("row", [])

/** A Thread of one Project and a terminal of another on one workspace,
 * as the Flow free leaves them: Arrange by Project moves them. */
function mixed(): Workspaces {
  const right = { place: "right" } as const
  const thread = { kind: "agents.thread", args: { thread: "t1" } }
  const terminal = { kind: "terminal.terminal", args: {} }
  return open(open(start(), newId(), thread, right), newId(), terminal, right)
}

/** Runs the Tiling's action `id` in `tiling`, as its key would. */
const run = (tiling: Tiling, id: string) =>
  TILING_ACTIONS.find((one) => one.id === id)!.run(tiling)

/** A Tiling whose workspaces are `state`, as the Window hands one in,
 * and the Undos it sent. */
function windowOf(state: Workspaces) {
  const steps: Step[] = []
  const change = (how: Change) => void steps.push(how(state))
  const tiling = { change, placing: () => row } as Partial<Tiling> as Tiling
  const undos = () =>
    steps.filter(
      (step): step is Plan =>
        step !== undefined &&
        "command" in step &&
        step.command.method === "workspaces.unarrange"
    )
  return { tiling, undos }
}

/** What the last toast offered: its Undo, if any. */
function offered() {
  const [title, options] = toast.mock.lastCall as [
    string,
    { action?: { label: string; onClick: () => void } },
  ]
  return { title, action: options.action }
}

test("the Person's Arrange by Project says so, and its Undo puts the workspaces back once, the Pane in front still in front (ADR 0102, decision 9)", () => {
  const state = mixed()
  const front = focused(state)?.id
  expect(front).toBeDefined()
  const { tiling, undos } = windowOf(state)
  run(tiling, "workspaces.arrange")
  const { title, action } = offered()
  expect(title).toBe("Arranged by Project")
  expect(action?.label).toBe("Undo")
  action?.onClick()
  action?.onClick()
  expect(undos()).toEqual([
    {
      command: { method: "workspaces.unarrange", params: {} },
      want: front,
      refused: expect.any(Function),
    },
  ])
  expect(toast.dismiss).toHaveBeenCalled()
})

test("an Arrange by Project that moves nothing says so, with no Undo", () => {
  const state = mixed()
  const plan = arranging(state, row)
  const moved = apply(keptOf(state), plan.command, newId())
  if ("refused" in moved) throw new Error(moved.message)
  const { tiling } = windowOf(resolve(moved.list, NO_VIEW))
  run(tiling, "workspaces.arrange")
  expect(offered()).toEqual({
    title: "Already arranged by Project",
    action: undefined,
  })
  expect(undoesNow()).toBe(false)
})

test("a refused Undo shows the engine's words", () => {
  const words = "Can't undo: the workspaces changed."
  const { tiling, undos } = windowOf(mixed())
  run(tiling, "workspaces.arrange")
  offered().action?.onClick()
  undos()[0]?.refused?.(new Refused({ code: "conflict", message: words }))
  expect(toast.error).toHaveBeenCalledWith(words)
})

test("Undo's key undoes the Arrange while its toast shows, but never a field's or a program's", () => {
  const { tiling, undos } = windowOf(mixed())
  run(tiling, "workspaces.arrange")
  document.body.innerHTML = [
    "<input />",
    "<textarea></textarea>",
    '<div contenteditable="true"><p tabindex="0">Typed</p></div>',
    '<div data-keys="program"><span tabindex="0">$</span></div>',
    '<div tabindex="0">A tile</div>',
  ].join("")
  const focus = (selector: string) =>
    document.querySelector<HTMLElement>(selector)?.focus()
  for (const field of ["input", "textarea", "p", "span"]) {
    focus(field)
    expect(undoesNow(), field).toBe(false)
  }
  focus("body > div:last-child")
  expect(undoesNow()).toBe(true)
  run(tiling, "workspaces.unarrange")
  expect(undos()).toHaveLength(1)
  expect(undoesNow()).toBe(false)
})

test("once the toast is gone, or another Arrange took its place, Ctrl+Z is left alone", () => {
  const { tiling, undos } = windowOf(mixed())
  document.body.innerHTML = ""
  run(tiling, "workspaces.arrange")
  expect(undoesNow()).toBe(true)
  const [, first] = toast.mock.lastCall as [string, { onAutoClose: () => void }]
  first.onAutoClose()
  expect(undoesNow()).toBe(false)

  // A second Arrange's toast takes the first one's place: the first's
  // Undo does nothing.
  run(tiling, "workspaces.arrange")
  const stale = offered().action
  run(tiling, "workspaces.arrange")
  stale?.onClick()
  expect(undos()).toEqual([])
  offered().action?.onClick()
  expect(undos()).toHaveLength(1)
})
