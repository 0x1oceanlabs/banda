import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { Device } from "@banda/contract/look"
import { NodeServices } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect, Layer, Option, Stream } from "effect"
import { Look } from "@banda/desktop-kit"
import { lookLayer } from "../look"
import { Program } from "../program"
import { script } from "../testing"
import { type System, systemLayer } from "./system"

const PLAIN: Device = { reduce_transparency: false, high_contrast: false }

/** A system that says `now`, and whoever listens to it. */
function fake(now: Device) {
  const listeners = new Set<() => void>()
  const system: System = {
    says: () => now,
    listen: (changed) => {
      listeners.add(changed)
      return () => listeners.delete(changed)
    },
  }
  return {
    system,
    listeners,
    /** The Person changes the system's settings to `next`. */
    change: (next: Device) => {
      now = next
      for (const changed of listeners) changed()
    },
  }
}

/** `device.json` in a folder that is not there yet. */
const fresh = () =>
  join(mkdtempSync(join(tmpdir(), "banda-test-")), "state", "device.json")

const read = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Device

/** Lets what a change started run. */
const settle = Effect.sleep("20 millis")

it.live(
  "what the system says is written as main starts, in a folder made for it, and again on each change (ADR 0100, decision 1)",
  () =>
    Effect.gen(function* () {
      const file = fresh()
      const { system, change } = fake(PLAIN)
      yield* Effect.gen(function* () {
        expect(read(file)).toEqual(PLAIN)
        const tinted = { ...PLAIN, accent: "#0a84ff", high_contrast: true }
        change(tinted)
        yield* settle
        expect(read(file)).toEqual(tinted)
        // Whole, with nothing left beside it.
        expect(readdirSync(dirname(file))).toEqual(["device.json"])
      }).pipe(Effect.provide(systemLayer(file, system)))
    })
)

it.live(
  "only a change is written: the look resolves the theme again each time the file changes",
  () =>
    Effect.gen(function* () {
      const file = fresh()
      const { system, change } = fake(PLAIN)
      yield* Effect.gen(function* () {
        rmSync(file)
        // The window's own mode changes `nativeTheme` too.
        change({ ...PLAIN })
        yield* settle
        expect(existsSync(file)).toBe(false)
        change({ ...PLAIN, reduce_transparency: true })
        yield* settle
        expect(read(file).reduce_transparency).toBe(true)
      }).pipe(Effect.provide(systemLayer(file, system)))
    })
)

it.live("a file that cannot be written is tried again on the next change", () =>
  Effect.gen(function* () {
    // A file where the state folder would be: nothing is written there.
    const blocker = script("")
    const file = join(blocker, "device.json")
    const { system, change } = fake(PLAIN)
    yield* Effect.gen(function* () {
      expect(existsSync(file)).toBe(false)
      rmSync(blocker)
      // The system says the same: it was never written, so it is now.
      change({ ...PLAIN })
      yield* settle
      expect(read(file)).toEqual(PLAIN)
    }).pipe(Effect.provide(systemLayer(file, system)))
  })
)

it.live("it listens only while main runs", () =>
  Effect.gen(function* () {
    const file = fresh()
    const { system, listeners, change } = fake(PLAIN)
    yield* Effect.sync(() => expect(listeners.size).toBe(1)).pipe(
      Effect.provide(systemLayer(file, system))
    )
    expect(listeners.size).toBe(0)
    change({ ...PLAIN, high_contrast: true })
    yield* settle
    expect(read(file)).toEqual(PLAIN)
  })
)

it.live(
  "the look starts once it is written, so the first look has it too",
  () =>
    Effect.gen(function* () {
      const file = fresh()
      // A look that says what it found in `device.json` as it started.
      const program = script(`cat "${file}"\necho\nexec sleep 60`)
      const first = yield* Look.use((look) =>
        Stream.runHead(look.changes)
      ).pipe(
        Effect.provide(
          lookLayer.pipe(
            Layer.provide(systemLayer(file, fake(PLAIN).system)),
            Layer.provide(Program.layer({ program })),
            Layer.provide(NodeServices.layer)
          )
        )
      )
      expect(Option.getOrNull(first)).toEqual(PLAIN)
    })
)
