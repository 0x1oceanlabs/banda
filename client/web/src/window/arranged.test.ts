// @vitest-environment happy-dom
import { newId, Refused } from "@banda/contract"
import { expect, test, vi } from "vitest"
import { keysInForce, pressFor, withKeys } from "../actions/actions"
import {
  type Change,
  keptOf,
  NO_VIEW,
  type Plan,
  resolve,
  type Step,
} from "../tiling/arrange"
import { apply } from "../tiling/arrangement"
import { focused, open, start, type Workspaces } from "../tiling/model"
import { ACTIONS, arranging, placingOf, runAction, type Shell } from "./actions"
import { undoesNow } from "./arranged"

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

/** A window whose workspaces are `state`, and the Undos it sent. */
function windowOf(state: Workspaces) {
  const steps: Step[] = []
  const change = (how: Change) => void steps.push(how(state))
  const shell = { change, placing: () => row }
  const undos = () =>
    steps.filter(
      (step): step is Plan =>
        step !== undefined &&
        "command" in step &&
        step.command.method === "workspaces.unarrange"
    )
  return { shell: shell as unknown as Shell, undos }
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
  const { shell, undos } = windowOf(state)
  runAction(shell, "workspaces.arrange")
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
  const { shell } = windowOf(resolve(moved.list, NO_VIEW))
  runAction(shell, "workspaces.arrange")
  expect(offered()).toEqual({
    title: "Already arranged by Project",
    action: undefined,
  })
  expect(undoesNow()).toBe(false)
})

test("a refused Undo shows the engine's words", () => {
  const words = "Can't undo: the workspaces changed."
  const { shell, undos } = windowOf(mixed())
  runAction(shell, "workspaces.arrange")
  offered().action?.onClick()
  undos()[0]?.refused?.(new Refused({ code: "conflict", message: words }))
  expect(toast.error).toHaveBeenCalledWith(words)
})

test("Ctrl+Z undoes the Arrange while its toast shows, but never a field's, a program's or a page's", () => {
  const keyed = withKeys(ACTIONS, [])
  const ctrlZ = {
    code: "KeyZ",
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    shiftKey: false,
  }
  expect(pressFor(keyed, ctrlZ)?.action.id).toBe("workspaces.unarrange")
  // A Pane's own Undo comes first, as Files'.
  expect(pressFor(keyed, ctrlZ, ["files"])?.action.id).toBe("files.undo")
  // Main never takes it from a browser's page.
  const inForce = keysInForce({ alt: true, ctrl: false, super: false }, keyed)
  const taken = inForce.byScope.get("") ?? []
  expect(taken.some((key) => key.code === "KeyZ" && !key.alt)).toBe(false)

  const { shell, undos } = windowOf(mixed())
  runAction(shell, "workspaces.arrange")
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
  runAction(shell, "workspaces.unarrange")
  expect(undos()).toHaveLength(1)
  expect(undoesNow()).toBe(false)
})

test("once the toast is gone, or another Arrange took its place, Ctrl+Z is left alone", () => {
  const { shell, undos } = windowOf(mixed())
  document.body.innerHTML = ""
  runAction(shell, "workspaces.arrange")
  expect(undoesNow()).toBe(true)
  const [, first] = toast.mock.lastCall as [string, { onAutoClose: () => void }]
  first.onAutoClose()
  expect(undoesNow()).toBe(false)

  // A second Arrange's toast takes the first one's place: the first's
  // Undo does nothing.
  runAction(shell, "workspaces.arrange")
  const stale = offered().action
  runAction(shell, "workspaces.arrange")
  stale?.onClick()
  expect(undos()).toEqual([])
  offered().action?.onClick()
  expect(undos()).toHaveLength(1)
})
