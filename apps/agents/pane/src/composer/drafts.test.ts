import { beforeEach, expect, test, vi } from "vitest"
import type { Image } from "@banda/contract/agents"

const stored = new Map<string, string>()
beforeEach(() => {
  vi.useFakeTimers()
  stored.clear()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  })
  vi.stubGlobal("window", {
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })
})

const image = (id: string) => ({ id, mime: "image/png", size: 1 }) as Image
const imagesIn = (thread: string) =>
  (
    JSON.parse(stored.get("banda.agents.draft-images") ?? "{}") as Record<
      string,
      Image[]
    >
  )[thread]?.map(({ id }) => id)

test("a message put back goes above what is new in the draft, after a blank line, its images after those there; with no words, the draft's text stays as it was (ADR 0105, Q5)", async () => {
  const { putBack } = await import("./drafts")
  stored.set("banda.agents.draft.t1", "and the slow ones first")
  stored.set("banda.agents.draft-images", JSON.stringify({ t1: [image("i1")] }))
  putBack("t1", "run the tests", [image("i1"), image("i2")])
  vi.advanceTimersByTime(300)
  expect(stored.get("banda.agents.draft.t1")).toBe(
    "run the tests\n\nand the slow ones first"
  )
  expect(imagesIn("t1")).toEqual(["i1", "i2"])

  // Images alone: the words stay as they were.
  putBack("t1", "", [image("i3")])
  vi.advanceTimersByTime(300)
  expect(stored.get("banda.agents.draft.t1")).toBe(
    "run the tests\n\nand the slow ones first"
  )
  expect(imagesIn("t1")).toEqual(["i1", "i2", "i3"])

  // Into an empty draft, as it was.
  putBack("t2", "only these")
  vi.advanceTimersByTime(300)
  expect(stored.get("banda.agents.draft.t2")).toBe("only these")
  expect(imagesIn("t2")).toBeUndefined()
})
