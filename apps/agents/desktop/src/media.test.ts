/**
 * A reply's media (ADR 0037, decision 8): its paths come from an Agent's
 * text, so the agents module's channel asks this machine's engine for a
 * token for an image, a video or a sound alone (`bytes.issue`, `media`),
 * in the Thread's Project, and gives the token, which the page names
 * with the one URL a Pane makes (`bytesUrl`). The engine judges the file
 * (platform/bytes); main reads none (ADR 0106, decision 6).
 */
import type { Engine as Client } from "@banda/contract"
import { Engine, Look } from "@banda/desktop-kit"
import { expect, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import { agentsDesktop } from "./index"

/** Main's services, as far as the channel asks them: an engine that
 * answers `bytes.issue` as `issue` does, and says what it was asked. */
const main = (issue: (path: string) => string | null) => {
  const asked: unknown[][] = []
  const client = {
    call: async (...call: unknown[]) => {
      asked.push(call)
      const [, { path }] = call as [string, { path: string }]
      const token = issue(path)
      if (token === null) throw new Error(`${path} is no picture`)
      return { token, until: 0 }
    },
  } as unknown as Client
  const layer = Layer.mergeAll(
    Layer.succeed(Engine)({
      address: Effect.die("unused"),
      client: Effect.succeed(client),
      door: Effect.die("unused"),
    }),
    Layer.succeed(Look)({
      current: Effect.succeed(null),
      changes: Stream.empty,
    })
  )
  return { asked, layer }
}

it.effect(
  "the media channel asks the engine for a picture's, a video's or a sound's token in the Thread's Project, and gives it; a refusal is none",
  () => {
    const { asked, layer } = main((path) =>
      path.endsWith(".txt") ? null : "a5e"
    )
    const [, media] = agentsDesktop.answers.media
    const ask = (path: string) => media(["p", path], {} as never)
    return Effect.gen(function* () {
      expect(yield* ask("shot.png")).toBe("a5e")
      expect(yield* ask("/elsewhere/clip.webm")).toBe("a5e")
      expect(yield* ask("notes.txt")).toBeNull()
      expect(asked).toEqual([
        ["bytes.issue", { path: "shot.png", use: "media" }, { project: "p" }],
        [
          "bytes.issue",
          { path: "/elsewhere/clip.webm", use: "media" },
          { project: "p" },
        ],
        ["bytes.issue", { path: "notes.txt", use: "media" }, { project: "p" }],
      ])
    }).pipe(Effect.provide(layer))
  }
)
