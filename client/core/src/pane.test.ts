import { expect, test } from "vitest"
import { paneHost, withHost } from "./pane"

test("a Pane names another host only by a host in its args, and keeps its object when that stays", () => {
  const pane = { kind: "agents.thread", args: { thread: "t1" } }
  expect(paneHost(pane)).toBeUndefined()
  expect(
    paneHost({ ...pane, args: { thread: "t1", host: "" } })
  ).toBeUndefined()
  expect(paneHost({ ...pane, args: { thread: "t1", host: 1 } })).toBeUndefined()
  const there = withHost(pane, "arc")
  expect(there.args).toEqual({ thread: "t1", host: "arc" })
  expect(paneHost(there)).toBe("arc")
  expect(withHost(there, "arc")).toBe(there)
  expect(withHost(pane, undefined)).toBe(pane)
  // Back on this machine, the host is gone, not left empty.
  expect(withHost(there, undefined).args).toEqual({ thread: "t1" })
  expect(pane.args).toEqual({ thread: "t1" })
})
