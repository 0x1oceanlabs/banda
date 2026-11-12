import { expect, test } from "vitest"
import { type HostState, shownOf } from "@banda/core"
import {
  awayShort,
  buildWords,
  factsWords,
  footWords,
  standingOf,
  stateWords,
} from "./words"

const live = (version: string | null, build = "abc1234ff"): HostState => ({
  name: "arc",
  ssh: "arc",
  state: "live",
  build,
  version,
  own: { build: "abc1234ff", version: "0.1.0-dev.421" },
})

test("a machine's state, in Settings' words", () => {
  expect(stateWords(live("0.1.0-dev.421"))).toBe("live · same build")
  expect(stateWords(live("0.1.0-dev.418", "def"))).toBe("live · other build")
  expect(stateWords({ name: "arc", ssh: "arc", state: "connecting" })).toBe(
    "connecting"
  )
  expect(
    stateWords({ name: "arc", ssh: "arc", state: "signin", url: "https://x" })
  ).toBe("sign in to Tailscale")
  expect(
    stateWords({ name: "arc", ssh: "arc", state: "away", why: "ssh ended" })
  ).toBe("away")
  expect(stateWords({ name: "arc", ssh: "arc", state: "stopped" })).toBe(
    "stopped"
  )
  expect(
    stateWords({ name: "arc", ssh: "arc", state: "refused", why: "no banda" })
  ).toBe("refused")
})

test("a live machine's build says whether it is this window's; none is known while it is not live", () => {
  expect(buildWords(live("0.1.0-dev.421"))).toBe("dev.421, same as here")
  expect(buildWords(live("0.1.0-dev.418", "def"))).toBe("dev.418 vs dev.421")
  // One that says no version is told by its build.
  expect(buildWords(live(null, "abc1234ff"))).toBe("abc1234 vs dev.421")
  expect(
    buildWords({ name: "arc", ssh: "arc", state: "stopped" })
  ).toBeUndefined()
})

test("what a machine says it is shows on one line, each part cleaned, a part it leaves out left out", () => {
  expect(factsWords(["SLIMBOOK EVO14", "Arch Linux"])).toBe(
    "SLIMBOOK EVO14 · Arch Linux"
  )
  expect(factsWords([undefined, "macOS 26.1"])).toBe("macOS 26.1")
  expect(factsWords(["\u200b", null])).toBe("")
  expect(factsWords(["x".repeat(60)])).toHaveLength(40)
})

const MINUTE = 60_000
const arc = { name: "arc", ssh: "arc" }

test("how long a machine is out of reach, by a card's short steps: away in its first seconds; stopped says so", () => {
  const now = 10 * 60 * MINUTE
  expect(awayShort({ since: now - 5_000 }, now)).toBe("away")
  expect(awayShort({ since: now - 40_000 }, now)).toBe("away 40s")
  expect(awayShort({ since: now - MINUTE }, now)).toBe("away 1m")
  expect(awayShort({ since: now - 12 * MINUTE }, now)).toBe("away 12m")
  expect(awayShort({ since: now - 3 * 60 * MINUTE, stopped: true }, now)).toBe(
    "stopped 3h"
  )
})

test("the foot's words and dot for a machine, by how the Window shows it (ADR 0098, decision 18)", () => {
  const now = 10 * 60 * MINUTE
  const seen = shownOf(undefined, live("0.1.0-dev.421"), 0)
  expect([footWords(seen, now), standingOf(seen.state)]).toEqual([
    "live",
    "live",
  ])
  expect(footWords(shownOf(seen, live("0.1.0-dev.418", "def"), 0), now)).toBe(
    "other build"
  )
  // Away since it was last heard, as its cards count it.
  const away = shownOf(
    seen,
    { ...arc, state: "away", why: "ssh ended" },
    now - 20 * MINUTE,
    undefined,
    now - 12 * MINUTE
  )
  expect([footWords(away, now), standingOf(away.state)]).toEqual([
    "away 12m",
    "away",
  ])
  const stopped = shownOf(seen, { ...arc, state: "stopped" }, now - MINUTE)
  expect(footWords(stopped, now)).toBe("stopped 1m")
  // Reaching it again after it was away, it is still out of reach.
  const back = shownOf(away, { ...arc, state: "connecting" }, now)
  expect([footWords(back, now), standingOf(back.state)]).toEqual([
    "away 12m",
    "away",
  ])
  const signin = shownOf(
    undefined,
    { ...arc, state: "signin", url: "https://x" },
    now
  )
  expect([footWords(signin, now), standingOf(signin.state)]).toEqual([
    "sign in to Tailscale",
    "asks",
  ])
  const refused = shownOf(
    undefined,
    { ...arc, state: "refused", why: "no banda" },
    now
  )
  expect([footWords(refused, now), standingOf(refused.state)]).toEqual([
    "refused",
    "refused",
  ])
})
