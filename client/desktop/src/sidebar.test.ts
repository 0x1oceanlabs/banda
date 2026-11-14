import { vi } from "vitest"
// The build takes the template in as text (build.mjs).
vi.mock("../../../platform/look/sidebar.toml", () => ({ default: "# new\n" }))
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "@effect/vitest"
import type { Look as LookValue } from "@banda/contract/look"
import { Look, type Refused } from "@banda/desktop-kit"
import { Effect, Layer, Stream } from "effect"
import type { IpcMainInvokeEvent } from "electron"
import { Editors } from "./editors"
import { sidebarAnswers } from "./sidebar"

const event = {} as IpcMainInvokeEvent

/** Main's services as the sidebar's answer uses them: a look that says
 * the sidebar's `file`, or none yet; and what was opened to edit. */
function fakes(file: string | null) {
  const edited: string[] = []
  const layer = Layer.mergeAll(
    Layer.succeed(Look)({
      current: Effect.succeed(
        file === null ? null : ({ sidebar: { file } } as LookValue)
      ),
      changes: Stream.empty,
    }),
    Layer.succeed(Editors)({
      edit: (path: string) => Effect.sync(() => void edited.push(path)),
    } as unknown as Editors["Service"])
  )
  return { edited, layer }
}

it.effect("Edit makes the file from the template when it is new", () => {
  const file = join(mkdtempSync(join(tmpdir(), "banda-test-")), "sidebar.toml")
  const { edited, layer } = fakes(file)
  return Effect.gen(function* () {
    yield* sidebarAnswers.edit[1]([], event)
    expect(readFileSync(file, "utf8")).toBe("# new\n")
    expect(edited).toEqual([file])
  }).pipe(Effect.provide(layer))
})

it.effect("Edit keeps a file that is there as the Person wrote it", () => {
  const file = join(mkdtempSync(join(tmpdir(), "banda-test-")), "sidebar.toml")
  writeFileSync(file, "group = false\n")
  const { edited, layer } = fakes(file)
  return Effect.gen(function* () {
    yield* sidebarAnswers.edit[1]([], event)
    expect(readFileSync(file, "utf8")).toBe("group = false\n")
    expect(edited).toEqual([file])
  }).pipe(Effect.provide(layer))
})

it.effect("before the first look the sidebar's file is not known", () => {
  const { edited, layer } = fakes(null)
  return Effect.gen(function* () {
    const refused = yield* Effect.flip(sidebarAnswers.edit[1]([], event))
    expect((refused as Refused).message).toBe(
      "The sidebar's file is not known yet."
    )
    expect(edited).toEqual([])
  }).pipe(Effect.provide(layer))
})
