import type { Status } from "@banda/contract/git"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { hearStatus, statusOf } from "./status"
import { fakeEngine, type Heard } from "./testing"

/** A watch's stream, its pieces a status. */
const said = (heard: Heard) => heard.onPiece as (status: Status) => void

const STATUS = { at: 1, repo: true, files: [], added: 0, removed: 0 }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test("every hearer of a Space shares one watch, kept a while after the last", () => {
  const { engine: one, streams } = fakeEngine()
  const [a, b] = [vi.fn(), vi.fn()]
  const stopA = hearStatus(one, "s", a)
  const stopB = hearStatus(one, "s", b)
  expect(streams).toHaveLength(1)
  said(streams[0]!)(STATUS)
  expect([a, b].map((heard) => heard.mock.calls.length)).toEqual([1, 1])
  expect(statusOf(one, "s")).toBe(STATUS)
  stopA()
  stopB()
  vi.advanceTimersByTime(60_000)
  expect(streams[0]!.stopped).toBe(true)
  expect(statusOf(one, "s")).toBeNull()
})

test("a watch the engine ended is asked again for those still hearing", () => {
  const { engine: one, streams } = fakeEngine()
  const heard = vi.fn()
  hearStatus(one, "s", heard)
  said(streams[0]!)(STATUS)
  streams[0]!.onEnd()
  expect(statusOf(one, "s")).toBeNull()
  vi.advanceTimersByTime(1000)
  expect(streams).toHaveLength(2)
  said(streams[1]!)({ ...STATUS, at: 2 })
  expect(statusOf(one, "s")?.at).toBe(2)
  expect(heard).toHaveBeenCalledTimes(3)
})

test("a refused watch waits for the next hearer, and a lingering one stays its Space's", () => {
  const { engine: one, streams } = fakeEngine()
  const stop = hearStatus(one, "s", () => {})
  streams[0]!.onEnd({ code: "forbidden", message: "No." })
  vi.advanceTimersByTime(5000)
  expect(streams).toHaveLength(1)
  stop()
  // Back before the linger ends: the same watch, asked again.
  hearStatus(one, "s", () => {})
  expect(streams).toHaveLength(2)
  vi.advanceTimersByTime(60_000)
  expect(streams[1]!.stopped).toBe(false)
})
