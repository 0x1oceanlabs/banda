/**
 * A reply's media (ADR 0037, decision 8): its paths come from an Agent's
 * text, so the agents module's channel gives a URL for an image, a video
 * or a sound, in the Project or anywhere on the machine, and for nothing
 * else, though the byte host serves any file a Pane opens.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Engine as Client } from "@banda/contract"
import { Engine, FileHost, Look } from "@banda/desktop-kit"
import { afterEach, beforeEach, expect, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import { agentsDesktop } from "./index"

let project: string
let elsewhere: string
beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "banda-project-"))
  elsewhere = await mkdtemp(join(tmpdir(), "banda-elsewhere-"))
})
afterEach(async () => {
  for (const dir of [project, elsewhere])
    await rm(dir, { recursive: true, force: true })
})

/** Main's services, as far as the channel asks them: one Project, `p`. */
const main = () =>
  Layer.mergeAll(
    FileHost.layer,
    Layer.succeed(Engine)({
      address: Effect.die("unused"),
      client: Effect.succeed({
        call: async () => [{ id: "p", folder: project }],
      } as unknown as Client),
      door: Effect.die("unused"),
      browser: Effect.die("unused"),
    }),
    Layer.succeed(Look)({
      current: Effect.succeed(null),
      changes: Stream.empty,
    })
  )

it.effect(
  "the media channel gives images, video and sound, from the Project or anywhere, and refuses any other file",
  () =>
    Effect.gen(function* () {
      const [, media] = agentsDesktop.answers.media
      const ask = (path: string) => media(["p", path], {} as never)
      yield* Effect.promise(async () => {
        for (const name of ["shot.png", "clip.webm", "notes.txt", "page.html"])
          await writeFile(join(project, name), name)
        await writeFile(join(project, "Makefile"), "all:")
        await writeFile(join(elsewhere, "screenshot.png"), "png")
      })
      for (const path of [
        "shot.png",
        "./clip.webm",
        join(elsewhere, "screenshot.png"),
      ])
        expect(yield* ask(path), path).toMatch(/^app:\/\/files\//)
      for (const path of [
        "notes.txt",
        "page.html",
        "Makefile",
        join(project, "notes.txt"),
      ])
        expect(yield* ask(path), path).toBeNull()
    }).pipe(Effect.provide(main()))
)
