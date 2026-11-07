import { NodeServices } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { loginPath, merged } from "./login"
import { script } from "./testing"

/** A login shell that sets PATH as a profile would, then runs what it is
 * asked to, after `before`. */
const shell = (path: string, before = "") =>
  script(`${before}\nshift\nPATH=${path} exec /bin/sh -c "$1"`)

const asked = (
  options: Partial<Parameters<typeof loginPath>[0]> & { shell: string }
) =>
  loginPath({
    platform: "darwin",
    own: "/usr/bin:/bin",
    term: undefined,
    wait: "2 seconds",
    ...options,
  }).pipe(Effect.provide(NodeServices.layer))

it("the login shell's folders come first, the window's own after, each once", () => {
  expect(
    merged("/Users/p/.local/bin:/opt/homebrew/bin:/usr/bin", "/usr/bin:/bin:")
  ).toBe("/Users/p/.local/bin:/opt/homebrew/bin:/usr/bin:/bin")
})

it.effect(
  "on macOS, the PATH the login shell prints, past what its profile says",
  () =>
    Effect.gen(function* () {
      const path = yield* asked({
        shell: shell("/Users/p/.local/bin:/usr/bin", 'echo "Welcome, Person"'),
      })
      expect(path).toEqual(Option.some("/Users/p/.local/bin:/usr/bin:/bin"))
    })
)

it.effect(
  "a shell that says nothing of its PATH leaves the PATH as it is",
  () =>
    Effect.gen(function* () {
      expect(yield* asked({ shell: script("exit 1") })).toEqual(Option.none())
    })
)

// On the real clock: the shell runs in real time.
it.live("a shell that does not answer in time leaves the PATH as it is", () =>
  Effect.gen(function* () {
    const path = yield* asked({
      shell: script("sleep 30"),
      wait: "200 millis",
    })
    expect(path).toEqual(Option.none())
  })
)

it.effect("a shell that is not there leaves the PATH as it is", () =>
  Effect.gen(function* () {
    const path = yield* asked({ shell: "/nowhere/zsh" })
    expect(path).toEqual(Option.none())
  })
)

it.effect("off macOS, the shell is not asked", () =>
  Effect.gen(function* () {
    const path = yield* asked({
      platform: "linux",
      shell: shell("/Users/p/.local/bin"),
    })
    expect(path).toEqual(Option.none())
  })
)

it.effect(
  "from a terminal, the PATH is the profile's already, and the shell is not asked",
  () =>
    Effect.gen(function* () {
      const path = yield* asked({
        term: "xterm-256color",
        shell: shell("/Users/p/.local/bin"),
      })
      expect(path).toEqual(Option.none())
    })
)
