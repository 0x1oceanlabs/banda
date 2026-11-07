import type { WindowRequest } from "@banda/contract"
import { Effect, Exit } from "effect"
import { expect, test } from "vitest"
import { CAPTURE, posting } from "./post"

const asked = (params: unknown): WindowRequest =>
  ({ id: 1, method: "sharing.post", params, within: 30_000 }) as WindowRequest

test("an event goes exactly as kept, to PostHog's US capture only", async () => {
  const posted: { url: string; body: string }[] = []
  const post = posting(() => async (url, init) => {
    posted.push({ url, body: init.body })
    return { ok: true, status: 200 }
  })
  const event = { event: "$exception", distinct_id: "7c2e", properties: {} }
  await Effect.runPromise(post(asked({ event })))
  expect(posted).toEqual([{ url: CAPTURE, body: JSON.stringify(event) }])
})

test("one PostHog did not take is refused, so it waits", async () => {
  const post = posting(() => async () => ({ ok: false, status: 503 }))
  const exit = await Effect.runPromiseExit(post(asked({ event: {} })))
  expect(Exit.isFailure(exit)).toBe(true)
  const nothing = await Effect.runPromiseExit(post(asked({})))
  expect(Exit.isFailure(nothing)).toBe(true)
})
