import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { CommandCall, ProjectId } from "@banda/contract"
import { clock, type Here, KEEP, Waiting } from "@banda/core/react"
import type { Args, WindowApi } from "@banda/ui/module"

const said = vi.hoisted(() => ({
  toasts: [] as { words: string; open?: () => void }[],
  drafts: [] as [string, string][],
  carried: [] as [string, string[]][],
}))
vi.mock("@banda/ui/components/sonner", () => ({
  toast: (words: string, more?: { action?: { onClick: () => void } }) =>
    said.toasts.push({ words, open: more?.action?.onClick }),
}))
vi.mock("../composer/drafts", () => ({
  putBack: (thread: string, text: string, carried: { id: string }[] = []) => {
    said.drafts.push([thread, text])
    if (carried.length > 0)
      said.carried.push([thread, carried.map(({ id }) => id)])
  },
}))
const { backWords, hearBack, imagesOf, rowOf, whenBackTitle } =
  await import("./WhenBack")

beforeEach(() => {
  said.toasts = []
  said.drafts = []
  said.carried = []
})
afterEach(() => vi.useRealTimers())

const PROJECT = "0196f000-0000-7000-8000-000000000021" as ProjectId
const at1432 = new Date(2026, 10, 10, 14, 32, 0).getTime()
const at1442 = at1432 + KEEP
/** A time as the core's clock says it by 24 hours: "14:42". */
const time = (at: number, now?: number) => clock(at, now, { hours: 24 })

/** A message to arc's Thread t1 that waits, sent at 14:32, with the
 * images `images`. */
const message = (text: string, images: string[] = []) => ({
  call: {
    method: "agents.send",
    params: { thread: "t1", text, images, settings: null, steer: false },
    command: "c1",
  } as CommandCall,
  host: "arc",
  project: PROJECT,
  item: "t1",
  text,
  carried: images.map((id) => ({ id, mime: "image/png", size: 1 })),
  pane: { kind: "agents.thread", args: { thread: "t1", host: "arc" } },
  at: at1432,
})

test("Send says it sends once the machine is back, until 10 minutes from now, and its key", () => {
  expect(whenBackTitle("arc", at1442, at1432)).toBe(
    `Sends once arc is back, until ${time(at1442, at1432)} ↵`
  )
  // Dates follow the core's clock, as Later's "until" does.
  const wednesday = at1432 + 24 * 60 * 60_000
  expect(whenBackTitle("arc", wednesday, at1432)).toBe(
    `Sends once arc is back, until ${time(wednesday, at1432)} ↵`
  )
  expect(time(wednesday, at1432)).not.toBe(time(at1432, at1432))
})

test("a waiting message's row says until when, with Keep for, Edit and Cancel; one on its way offers none; one that may have gone through says so, with Cancel alone", () => {
  vi.useFakeTimers({ now: at1432 })
  const waits = {
    ...message("and run them again with 8 shards"),
    until: at1442,
  }
  expect(rowOf(waits)).toEqual({
    text: "and run them again with 8 shards",
    says: `until ${time(at1442)}`,
    keepFor: true,
    edit: true,
    cancel: true,
  })
  expect(rowOf({ ...waits, going: true })).toMatchObject({
    keepFor: false,
    edit: false,
    cancel: false,
  })
  expect(rowOf({ ...waits, went: true })).toEqual({
    text: "and run them again with 8 shards",
    says: "may have gone through",
    keepFor: false,
    edit: false,
    cancel: true,
  })
  // Images alone: no words, the images shown above as in the Queue.
  const images = { ...message("", ["i1", "i2"]), until: at1442 }
  expect(rowOf(images).text).toBe("")
  expect(imagesOf(images).map(({ id }) => id)).toEqual(["i1", "i2"])
})

test("what comes back says why: not sent while the machine was away, may have gone through, or its host's words", () => {
  expect(backWords({ kind: "expired" }, "arc", at1442)).toBe(
    `Not sent: arc was still away at ${time(at1442)}.`
  )
  expect(backWords({ kind: "went" }, "arc", at1442)).toBe(
    "arc went away; your message may have gone through."
  )
  expect(
    backWords(
      { kind: "refused", message: "There is no such Thread." },
      "arc",
      at1442
    )
  ).toBe("Not sent: There is no such Thread.")
})

test("a message that did not go in its time goes back into its draft with a toast, which has Open unless its Thread is the Pane in focus", async () => {
  vi.useFakeTimers({ now: at1432 })
  const waiting = new Waiting(undefined, { named: () => "arc" })
  let focused: Here["pane"] = { id: "e1", project: PROJECT, subject: "t1" }
  const ran: [string, Args | undefined][] = []
  const window = {
    waiting,
    here: { get: () => ({ pane: focused }) },
    run: (action: string, args?: Args) => void ran.push([action, args]),
  } as unknown as WindowApi
  const stop = hearBack(window)

  waiting.add(message("first", ["i1"]))
  await vi.advanceTimersByTimeAsync(KEEP)
  // Its words and its images.
  expect(said.drafts).toEqual([["t1", "first"]])
  expect(said.carried).toEqual([["t1", ["i1"]]])
  expect(said.toasts).toEqual([
    { words: `Not sent: arc was still away at ${time(at1442)}.` },
  ])

  focused = { id: "e2", project: PROJECT, subject: "t2" }
  waiting.add({ ...message("second"), at: Date.now() })
  await vi.advanceTimersByTimeAsync(KEEP)
  expect(said.drafts.at(-1)).toEqual(["t1", "second"])
  said.toasts.at(-1)!.open!()
  expect(ran).toEqual([
    [
      "pane.pick",
      {
        project: PROJECT,
        pane: { kind: "agents.thread", args: { thread: "t1", host: "arc" } },
      },
    ],
  ])

  // Another module's is not the agents module's.
  const others: string[] = []
  waiting.onBack((back) => others.push(back.wait.text) > 0, { after: true })
  waiting.add({
    ...message("a terminal's"),
    pane: { kind: "terminal", args: {} },
    at: Date.now(),
  })
  await vi.advanceTimersByTimeAsync(KEEP)
  expect(others).toEqual(["a terminal's"])
  expect(said.toasts).toHaveLength(2)
  stop()
  waiting.close()
})
