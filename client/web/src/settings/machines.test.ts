import { expect, test } from "vitest"
import type { HostState, HostTest } from "@banda/core"
import { Refused } from "@banda/contract"
import { ELSEWHERE } from "../boot"
import {
  addedWords,
  failedWords,
  buildWords,
  factsWords,
  foundNamed,
  movedIcon,
  numbered,
  settle,
  settleWords,
  stateWords,
  testWords,
  Told,
} from "./machines"

test("a name a machine shown has is numbered from 2, past the numbers taken, whatever its case", () => {
  expect(numbered("Cloud", [])).toBe("Cloud")
  expect(numbered("Cloud", ["arc"])).toBe("Cloud")
  expect(numbered("Cloud", ["Cloud"])).toBe("Cloud 2")
  // "Cloud 1" is no number Add gives: the first is 2.
  expect(numbered("Cloud", ["Cloud", "Cloud 1"])).toBe("Cloud 2")
  expect(numbered("Cloud", ["Cloud", "Cloud 2"])).toBe("Cloud 3")
  expect(numbered("Windows PC", ["windows pc"])).toBe("Windows PC 2")
  // A name of 16 is cut before its number, so it stays 16 at most.
  expect(numbered("a-very-long-name", ["a-very-long-name"])).toBe(
    "a-very-long-na 2"
  )
  expect(numbered("build box here x", ["build box here x"])).toBe(
    "build box here 2"
  )
})

test("only a server moves on, to the tower and then the database, and stays with all three taken", () => {
  expect(movedIcon("server", [])).toBe("server")
  expect(movedIcon("server", ["laptop"])).toBe("server")
  expect(movedIcon("server", ["server"])).toBe("tower")
  expect(movedIcon("server", ["server", "tower"])).toBe("database")
  expect(movedIcon("server", ["server", "tower", "database"])).toBe("server")
  // Two laptops keep one icon: their names tell them apart.
  expect(movedIcon("laptop", ["laptop"])).toBe("laptop")
  expect(movedIcon("vm", ["vm", "server"])).toBe("vm")
})

test("Add settles a new machine beside the ones shown, and says what it will write and why", () => {
  const shown = [
    { name: "m1pro", icon: "laptop" as const },
    { name: "arc", icon: "server" as const },
  ]
  // Nothing clashes: it stays as it names itself.
  const devbox = settle({ name: "devbox", icon: "desktop" }, shown)
  expect(devbox).toEqual({ named: { name: "devbox", icon: "desktop" } })
  expect(settleWords(devbox)).toEqual([])
  expect(addedWords("devbox", devbox)).toBe("Added devbox.")

  // Its icon clashes with arc's: it moves on, as the mock says it.
  const moved = settle({ name: "devbox", icon: "server" }, shown)
  expect(moved).toEqual({
    named: { name: "devbox", icon: "tower" },
    sameIcon: "arc",
  })
  expect(settleWords(moved)).toEqual([
    "arc has the server icon, so Add gives the new machine the tower.",
  ])

  // Both clash.
  const both = settle({ name: "ARC", icon: "server" }, shown)
  expect(both).toEqual({
    named: { name: "ARC 2", icon: "tower" },
    sameName: "ARC",
    sameIcon: "arc",
  })
  expect(settleWords(both)).toEqual([
    "ARC is taken, so Add names the new machine ARC 2 and writes that on it.",
    "arc has the server icon, so Add gives the new machine the tower.",
  ])
  expect(addedWords("arc", both)).toBe(
    "Added ARC 2. Written on it: the name ARC 2 and the tower icon. Change it in its row."
  )
  // Its write refused: by the name it has, and why.
  expect(addedWords("arc", both, "Too long.")).toBe(
    "Added ARC, but Banda could not write the name ARC 2 and the tower icon on it: Too long."
  )
  // Nothing clashed: by the name it says, not the key it was added by.
  expect(addedWords("box2", settle({ name: "Cloud", icon: "vm" }, shown))).toBe(
    "Added Cloud."
  )
  // Before its first welcome, by the name Connect found.
  expect(addedWords("arc")).toBe("Added arc.")
})

const live = (version: string | null, build = "abc1234ff"): HostState => ({
  name: "arc",
  ssh: "arc",
  state: "live",
  build,
  version,
  own: { build: "abc1234ff", version: "0.1.0-dev.421" },
})

test("a machine's state, in Settings' own words", () => {
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

test("a Test says what it found, cleaned, or why it found nothing", () => {
  const found: HostTest = {
    state: "found",
    system: "Arch\u202e Linux",
    named: { name: "arc‮", icon: "server" },
    banda: { build: "abc", version: "0.1.0-dev.421" },
    own: { build: "abc", version: "0.1.0-dev.421" },
    engine: null,
  }
  expect(testWords(found, "arc-key")).toEqual({
    found: true,
    title: "Found arc · Arch Linux",
    detail: "banda dev.421, same build",
  })
  expect(foundNamed(found, "arc-key")).toEqual({ name: "arc", icon: "server" })
  // From a banda before names, with no system: by the key, or address.
  const older: HostTest = {
    ...found,
    system: null,
    named: null,
    banda: { build: "def", version: "0.1.0-dev.418" },
  }
  expect(testWords(older, "roma@devbox")).toEqual({
    found: true,
    title: "Found roma@devbox",
    detail: "banda dev.418, dev.421 here",
  })
  expect(foundNamed(older, "roma@devbox")).toBeUndefined()
  expect(
    testWords({ state: "away", why: "ssh could not reach arc" }, "arc")
  ).toEqual({ found: false, title: "No answer: ssh could not reach arc" })
  expect(
    testWords(
      { state: "refused", why: "no banda-dev found there; set banda" },
      "arc"
    ).title
  ).toBe("Cannot use it: no banda-dev found there; set banda")
  expect(testWords({ state: "signin", url: "https://x" }, "arc").title).toBe(
    "Sign in to Tailscale to reach it"
  )
})

test("what went wrong is Settings' own words, the window's, main's over the bridge, or the engine's", () => {
  expect(
    failedWords(
      new Error(
        "Error invoking remote method 'hostAdd': Error: arc is in hosts.toml already"
      )
    )
  ).toBe("arc is in hosts.toml already")
  expect(
    failedWords(new Refused({ code: "invalid", message: "Too long." }))
  ).toBe("Too long.")
  expect(failedWords(new Error("x"))).toBe("Something went wrong. Try again.")
  // Settings' own words, and the window's without the desktop.
  expect(failedWords(new Told("Rename arc when it is back"))).toBe(
    "Rename arc when it is back"
  )
  expect(failedWords(new Error(ELSEWHERE))).toBe(
    "Only Banda's app reaches other machines."
  )
})

test("what a machine says it is shows on one line, each part cleaned, a part it leaves out left out", () => {
  expect(factsWords(["SLIMBOOK EVO14", "Arch Linux"])).toBe(
    "SLIMBOOK EVO14 · Arch Linux"
  )
  expect(factsWords([undefined, "macOS 26.1"])).toBe("macOS 26.1")
  expect(factsWords(["\u200b", null])).toBe("")
  expect(factsWords(["x".repeat(60)])).toHaveLength(40)
})
