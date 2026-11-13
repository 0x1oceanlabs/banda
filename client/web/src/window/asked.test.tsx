// @vitest-environment happy-dom
/**
 * An action asked from outside the window runs by its id, as its key
 * does, and the window answers: it ran, or why not (ADR 0127, decision
 * 2).
 */
import type { ActAnswer, ActAsk } from "@banda/core"
import { FORGETTING, type HostsDevice, KeptHosts } from "@banda/core"
import type { ProjectSummary } from "@banda/contract"
import type { PaneState } from "@banda/ui/pane"
import { act as settled } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { arcHosts, R1 } from "../tiling/testing"
import type { Shell } from "./actions"
import { act, useAsked } from "./asked"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(window, "banda")
})

/** No other machine: the hosts of a window alone. */
const NO_HOSTS: HostsDevice = {
  follow: () => undefined,
  engine: () => Promise.reject(new Error("No other machine here.")),
  start: () => undefined,
}

/** A Shell of `parts`, the Person in Project "a" of this machine. */
const shellOf = (parts: object) => {
  const hosts = new KeptHosts(NO_HOSTS, FORGETTING)
  hosts.ours([{ id: "a", name: "a" }] as unknown as ProjectSummary[])
  return {
    here: { get: () => ({ project: "a" }) },
    hosts,
    ...parts,
  } as unknown as Shell
}

/** The Pane in focus, of `scope`, whose scope takes what `takes` says;
 * what it was sent. */
function focusedPane(scope: string, takes = true): string[] {
  const sent: string[] = []
  const tile = document.createElement("div")
  Object.assign(tile.dataset, { tile: "", focused: "true", scope })
  tile.addEventListener("banda:act", (event) => {
    sent.push((event as CustomEvent<{ id: string }>).detail.id)
    if (takes) event.preventDefault()
  })
  document.body.append(tile)
  return sent
}

test("an action runs by its id with its args, where the Person is now, and one the window has not is refused by name", async () => {
  const pick = vi.fn()
  const shell = shellOf({ pick, closeSheet: () => true })
  const pane: PaneState = { kind: "agents.thread", args: { thread: "t1" } }
  const args = { project: "a", pane }
  expect(await act(shell, { action: "pane.pick", args })).toBeUndefined()
  expect(pick.mock.calls).toEqual([["a", pane]])
  expect(await act(shell, { action: "no.such" })).toBe(
    "Banda's window has no action no.such."
  )
})

test("an action the router does not run where the Person is says why, as its toast does", async () => {
  const shell = shellOf({
    hosts: arcHosts(["agents"]),
    here: { get: () => ({ project: R1 }) },
  })
  const peek = { action: "file.peek", args: { file: "/r1/a.ts", project: R1 } }
  expect(await act(shell, peek)).toBe("Not on arc yet: Quick Look at a file")
})

test("an action of a scope runs for the Pane in focus when it is of that scope, else it is refused naming the scope", async () => {
  const shell = shellOf({})
  const zoom = { action: "terminal.zoom-in" }
  // No Pane in focus, then a Pane of another scope.
  const nowhere =
    'terminal.zoom-in runs in the scope "terminal", and the focus is not there now.'
  expect(await act(shell, zoom)).toBe(nowhere)
  const browser = focusedPane("browser")
  expect(await act(shell, zoom)).toBe(nowhere)
  expect(browser).toEqual([])

  document.body.replaceChildren()
  const terminal = focusedPane("terminal")
  expect(await act(shell, zoom)).toBeUndefined()
  expect(terminal).toEqual(["terminal.zoom-in"])

  // A scope that leaves it, as a field does a key, did nothing.
  document.body.replaceChildren()
  focusedPane("terminal", false)
  expect(await act(shell, zoom)).toBe(
    "terminal.zoom-in did nothing where the focus is now."
  )
})

test("the window answers each action the device asks it to run, and one that broke says so", async () => {
  let ask: (asked: ActAsk) => void = () => undefined
  const answers: ActAnswer[] = []
  const stopped = vi.fn()
  Object.assign(window, {
    banda: {
      act: {
        asked: (listener: typeof ask) => {
          ask = listener
          return stopped
        },
        answer: (answer: ActAnswer) => answers.push(answer),
      },
      popped: { asked: () => () => undefined },
    },
  })
  const pick = vi.fn(() => {
    throw new Error("The workspaces are away.")
  })
  const shell = shellOf({ pick, closeSheet: () => true })
  const Asked = () => {
    useAsked(shell, () => undefined)
    return null
  }
  const root = createRoot(document.createElement("div"))
  await settled(async () => root.render(<Asked />))

  ask({ id: 1, action: "no.such" })
  ask({ id: 2, action: "quiet.toggle" })
  const pane: PaneState = { kind: "agents.thread", args: { thread: "t1" } }
  ask({ id: 3, action: "pane.pick", args: { project: "a", pane } })
  await vi.waitFor(() => expect(answers).toHaveLength(3))
  // Each by its id: one that ran at once may answer before one refused.
  expect(answers.sort((a, b) => a.id - b.id)).toEqual([
    { id: 1, refused: "Banda's window has no action no.such." },
    { id: 2 },
    { id: 3, refused: "Error: The workspaces are away." },
  ])
  settled(() => root.unmount())
  expect(stopped).toHaveBeenCalledOnce()
})
