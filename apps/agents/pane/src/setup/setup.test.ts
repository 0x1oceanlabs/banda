import { expect, test } from "vitest"
import type { Setup, SetupStep } from "@banda/contract/harnesses"
import { headOf, rowOf, stepWord, stoppedAt } from "./setup"

const step = (
  id: string,
  state: SetupStep["state"],
  note?: string
): SetupStep => ({
  id,
  name: id === "install" ? "Codex" : id === "git" ? "Git" : "Sign in",
  says: "",
  state,
  ...(note && { note }),
})

const setup = (
  states: [SetupStep["state"], SetupStep["state"], SetupStep["state"]],
  more: Partial<Setup> = {}
): Setup => ({
  harness: "codex",
  name: "Codex",
  steps: [
    step("git", states[0]),
    step("install", states[1]),
    step("sign_in", states[2]),
  ],
  running: false,
  ready: states[1] === "done" && states[2] === "done",
  output: "",
  ...more,
})

test("a row says where its Harness is, and has one button or none", () => {
  expect(rowOf(setup(["waiting", "waiting", "waiting"]))).toEqual({
    line: "Not on this computer",
    button: "Set up",
  })
  expect(rowOf(setup(["done", "done", "waiting"]))).toEqual({
    line: "Not signed in",
    button: "Sign in",
  })
  expect(
    rowOf(setup(["done", "running", "waiting"], { running: true }))
  ).toEqual({ line: "Setting up · 2 of 3", button: "Show" })
  expect(
    rowOf(setup(["done", "done", "asks"], { running: true, login: "l" }))
  ).toEqual({ line: "Waits for you · Sign in", tone: "asks", button: "Show" })
  expect(rowOf(setup(["done", "done", "done"]))).toEqual({
    line: "Ready",
    tone: "ready",
  })
})

test("a Git that failed stops no Harness that is ready", () => {
  const ready = setup(["failed", "done", "done"])
  expect(stoppedAt(ready)).toBeUndefined()
  expect(rowOf(ready).line).toBe("Ready")
  expect(headOf(ready).title).toBe("Codex is ready")
})

test("a setup that stopped says why, in the step's own words", () => {
  const stopped = setup(["done", "waiting", "waiting"])
  stopped.steps[1] = step("install", "failed", "no connection")
  expect(rowOf(stopped)).toEqual({
    line: "Stopped · no connection",
    tone: "failed",
    button: "Try again",
  })
  expect(headOf(stopped)).toEqual({
    title: "Setting up stopped",
    says: "Codex did not finish. You can try again.",
  })
})

test("a Harness with no steps is its Person's to set up", () => {
  const own = { ...setup(["done", "done", "done"]), steps: [] }
  expect(rowOf(own)).toEqual({ line: "Set up by you" })
})

test("a sheet's head follows the setup", () => {
  expect(headOf(setup(["done", "waiting", "waiting"])).title).toBe(
    "Set up Codex"
  )
  expect(headOf(setup(["done", "done", "waiting"])).says).toMatch(/^One step,/)
  expect(
    headOf(setup(["done", "running", "waiting"], { running: true })).title
  ).toBe("Setting up Codex")
  expect(
    headOf(setup(["done", "done", "asks"], { running: true, login: "l" })).title
  ).toBe("Sign in to Codex")
})

test("a step that waits says nothing at its right", () => {
  expect(stepWord(step("install", "waiting"))).toBeUndefined()
  expect(stepWord(step("install", "asks"))).toBe("Waits for you")
})
