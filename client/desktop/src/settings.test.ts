import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Settings } from "@banda/desktop-kit"
import { Program } from "./program"
import { settingsLayer } from "./settings"
import { script } from "./testing"

/**
 * A `banda` that answers as `banda settings` and `banda look themes` do:
 * `settings set` with the value "bad" refuses (code 1), with "broken"
 * breaks (code 2), else is done; `look themes` lists two themes and
 * counts how often it was asked.
 */
function fakeBanda(): string {
  return script(`here=$(dirname "$0")
if [ "$1" = look ]; then
  echo x >> "$here/asked"
  echo '{"name":"tokyo-night"}'
  echo '{"name":"nord"}'
  exit 0
fi
case "$5" in
  bad) echo "browser.toml:1: tabs is top or left" >&2; echo "and one more" >&2; exit 1 ;;
  broken) echo "it broke" >&2; exit 2 ;;
esac
exit 0`)
}

const settingsOf = (program: string) =>
  settingsLayer.pipe(
    Layer.provide(Program.layer({ program })),
    Layer.provide(NodeServices.layer)
  )

it.live(
  "a set that is done says nothing; a refused one says each problem",
  () =>
    Effect.gen(function* () {
      const done = yield* Settings.use((s) =>
        s.set("browser.toml", "tabs", '"left"')
      )
      expect(done).toEqual([])
      const refused = yield* Settings.use((s) =>
        s.set("browser.toml", "tabs", "bad")
      )
      expect(refused).toEqual([
        "browser.toml:1: tabs is top or left",
        "and one more",
      ])
    }).pipe(Effect.provide(settingsOf(fakeBanda())))
)

it.live("a set that breaks fails with what it said", () =>
  Effect.gen(function* () {
    const broke = yield* Effect.flip(
      Settings.use((s) => s.set("browser.toml", "tabs", "broken"))
    )
    expect(broke.message).toBe("it broke")
  }).pipe(Effect.provide(settingsOf(fakeBanda())))
)

it.live("the themes are read once", () => {
  const program = fakeBanda()
  return Effect.gen(function* () {
    const first = yield* Settings.use((s) => s.themes)
    const again = yield* Settings.use((s) => s.themes)
    expect(first).toEqual([{ name: "tokyo-night" }, { name: "nord" }])
    expect(again).toEqual(first)
    expect(readFileSync(join(dirname(program), "asked"), "utf8")).toBe("x\n")
  }).pipe(Effect.provide(settingsOf(program)))
})
