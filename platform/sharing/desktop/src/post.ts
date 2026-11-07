/**
 * The one place Banda's events leave the computer (ADR 0039, decisions 4
 * and 8). The engine's part keeps each event first and decides what goes;
 * it asks this to post one, exactly as kept, to PostHog's US capture and
 * nowhere else. It goes with Chromium's network, the system's proxy and
 * certificates, in a session of its own that keeps no cookie.
 */
import type { WindowRequest } from "@banda/contract"
import { Refused } from "@banda/desktop-kit"
import { Effect } from "effect"

/** Where an event goes: PostHog's capture, in the US. */
export const CAPTURE = "https://us.i.posthog.com/i/v0/e/"

type Fetch = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body: string
    signal: AbortSignal
  }
) => Promise<{ ok: boolean; status: number }>

/** Posts the event `request` holds with `fetch`; refused unless PostHog
 * took it, so the engine keeps it waiting. */
export const posting = (fetch: () => Fetch) => (request: WindowRequest) =>
  Effect.tryPromise({
    try: async (signal) => {
      const { event } = request.params as { event?: unknown }
      if (typeof event !== "object" || event === null)
        throw new Error("there is no event to post")
      const response = await fetch()(CAPTURE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
        signal,
      })
      if (!response.ok) throw new Error(`PostHog answered ${response.status}`)
      return null
    },
    catch: (error) =>
      new Refused({
        message: `The event was not sent: ${error instanceof Error ? error.message : String(error)}.`,
        code: "may_have_run",
      }),
  })
