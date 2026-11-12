// @vitest-environment happy-dom
/**
 * Another machine's settings (ADR 0106, step 5b): whose copy each key is,
 * by its schema, and a machine's part read through its engine and read
 * again as that engine says it changed.
 */
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, test, vi } from "vitest"
import { type Engine, Unreachable } from "@banda/contract"
import {
  classOf,
  hasMachinePart,
  type MachineSettings,
  throughEngine,
  useMachineSettings,
} from "./machine-settings"

test("a key is the machine's, shared or the device's by its top-level key's class, the device's in doubt", () => {
  expect(classOf("agents.toml", "start.account")).toBe("machine")
  expect(classOf("agents.toml", "enter")).toBe("shared")
  expect(classOf("sharing.toml", "problems")).toBe("machine")
  expect(classOf("browser.toml", "agents.sites")).toBe("machine")
  expect(classOf("browser.toml", "tabs.side")).toBe("device")
  expect(classOf("look.toml", "notify.on")).toBe("shared")
  expect(classOf("nothing.toml", "x")).toBe("device")
  expect(hasMachinePart("sharing.toml")).toBe(true)
  expect(hasMachinePart("terminal.toml")).toBe(false)
  expect(hasMachinePart("look.toml")).toBe(false)
})

/** An engine that answers `keys.settings_read` with `value` for `file`,
 * and lets the test say a file changed. */
function machine(value: () => string) {
  let told: ((piece: { file: string; rev: string }) => void) | undefined
  const calls: unknown[][] = []
  const engine = {
    call: vi.fn(async (method: string, params: { file: string }) => {
      calls.push([method, params])
      if (method !== "keys.settings_read")
        throw new Unreachable("arc", "arc is away")
      return {
        file: params.file,
        path: `/home/roma/.config/banda/${params.file}`,
        keyed: { problems: { value: value(), from: { layer: "file" } } },
        problems: [],
        rev: value(),
      }
    }),
    stream: (
      _: unknown,
      __: string,
      ___: unknown,
      piece: (one: { file: string; rev: string }) => void
    ) => {
      told = piece
      piece({ file: "sharing.toml", rev: "1" })
      return () => (told = undefined)
    },
  } as unknown as Engine
  return { engine, calls, change: (file: string) => told?.({ file, rev: "2" }) }
}

test("a machine's part is read through its engine, again as it says a file changed, and only for files with a part of its", async () => {
  let now = "on"
  const { engine, calls, change } = machine(() => now)
  let seen: MachineSettings | undefined
  function Probe() {
    seen = useMachineSettings(engine, ["sharing.toml", "terminal.toml"])
    return null
  }
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  await act(async () => {
    createRoot(document.createElement("div")).render(createElement(Probe))
  })
  expect(seen?.keyed["sharing.toml"]?.problems?.value).toBe("on")
  expect(seen?.paths["sharing.toml"]).toBe(
    "/home/roma/.config/banda/sharing.toml"
  )
  now = "off"
  await act(async () => {
    change("terminal.toml")
  })
  expect(seen?.keyed["sharing.toml"]?.problems?.value).toBe("on")
  await act(async () => {
    change("sharing.toml")
  })
  expect(seen?.keyed["sharing.toml"]?.problems?.value).toBe("off")
  expect(
    calls.filter(
      ([, params]) => (params as { file: string }).file !== "sharing.toml"
    )
  ).toEqual([])
})

test("a write through a machine's engine says its refusal in words, none when written", async () => {
  const { engine } = machine(() => "on")
  const writer = throughEngine(engine)
  expect(await writer.set("sharing.toml", "problems", "true")).toEqual([
    "arc is away: nothing was sent.",
  ])
})
