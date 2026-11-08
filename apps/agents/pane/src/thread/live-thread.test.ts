import { expect, test } from "vitest"
import { event } from "../testing"
import { follow } from "./live-thread"
import { EMPTY } from "./state"

const fence = { fence: "missing", why: "off", words: "BANDA_FENCE=off" }

test("a turn Banda kept Supervised says why and when, which the Person's next choice keeps", () => {
  const said = event("thread.configured", {
    thread: "t",
    settings: { mode: "supervised", options: {} },
    supervised: { before: true, fence },
  })
  const kept = follow(EMPTY, said)
  expect(kept.settings.mode).toBe("supervised")
  expect(kept.supervised).toEqual({ before: true, fence, at: said.at })
  const chosen = follow(
    kept,
    event("thread.configured", {
      thread: "t",
      settings: { mode: "full_access", options: {} },
    })
  )
  expect(chosen.settings.mode).toBe("full_access")
  expect(chosen.supervised).toEqual(kept.supervised)
  // What the Pane already followed is not heard again.
  expect(follow(chosen, said)).toBe(chosen)
})
