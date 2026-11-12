import { expect, test } from "vitest"
import type { HostState, HostTest } from "@banda/core"
import { Refused } from "@banda/contract"
import { ELSEWHERE } from "../boot"
import {
  addedWords,
  AWAKE_ROWS,
  awakeOn,
  awakeSaid,
  awakeValue,
  ended,
  failedWords,
  buildWords,
  factsWords,
  foundNamed,
  lidWords,
  movedIcon,
  NO_ACTS,
  numbered,
  pluggedInThere,
  powerRow,
  settle,
  settleWords,
  shownActs,
  shownOn,
  started,
  stateWords,
  testWords,
  installSteps,
  shellLine,
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

test("acts that overlap keep a part busy until the last ends, with the words of the latest still running", () => {
  const testing = { words: "Testing arc…" }
  const adding = { words: "Adding…" }
  expect(shownActs(NO_ACTS)).toEqual({ busy: false })
  const both = started(started(NO_ACTS, testing), adding)
  expect(shownActs(both)).toEqual({ busy: true, doing: "Adding…" })
  // The first to end leaves the other running, and its words shown.
  const left = ended(both, testing)
  expect(shownActs(left)).toEqual({ busy: true, doing: "Adding…" })
  expect(shownActs(ended(left, adding))).toEqual({ busy: false })
  // The latest ending first gives the words back to the one still running.
  expect(shownActs(ended(both, adding))).toEqual({
    busy: true,
    doing: "Testing arc…",
  })
})

test("an act is known by itself: one of two with the same words ends only itself", () => {
  const first = { words: "Working…" }
  const second = { words: "Working…" }
  const both = started(started(NO_ACTS, first), second)
  const left = ended(both, first).running
  expect(left).toHaveLength(1)
  expect(left[0]).toBe(second)
  expect(shownActs(ended(ended(both, second), first)).busy).toBe(false)
})

test("what went wrong stays until the next act starts, whatever ends meanwhile", () => {
  const address = { words: "Working…" }
  const testing = { words: "Testing arc…" }
  const both = started(started(NO_ACTS, testing), address)
  // The address is refused while the Test runs on.
  const refused = ended(both, address, "ssh refuses it")
  expect(shownActs(refused)).toEqual({
    busy: true,
    doing: "Testing arc…",
    problem: "ssh refuses it",
  })
  // The Test ends well: the refusal stays.
  const done = ended(refused, testing)
  expect(shownActs(done)).toEqual({ busy: false, problem: "ssh refuses it" })
  // The next act takes it out.
  expect(shownActs(started(done, testing))).toEqual({
    busy: true,
    doing: "Testing arc…",
  })
})

/** A setting as the look reads it from the file, or from Banda's own. */
const setting = (value: boolean, layer = "file") => ({
  value,
  from: { layer },
})

/** What an engine's `machines.get` answers, kept awake as `awake` says. */
const naming = (awake?: object, more: object = {}) => ({
  name: "m1pro",
  icon: "laptop",
  found: { name: "m1pro", icon: "laptop" },
  ...(awake && { awake }),
  ...more,
})

test("this machine stays awake as the look reads its machine.toml, else as its engine said, else as Banda does by itself", () => {
  // Banda's own: awake while Agents work, not for being plugged in.
  expect(awakeOn("awake-while-working", undefined)).toBe(true)
  expect(awakeOn("awake-plugged-in", undefined)).toBe(false)
  // The look reads the file, so a change by hand shows.
  const keyed = {
    "awake-while-working": setting(false),
    "awake-plugged-in": setting(true),
  }
  expect(awakeOn("awake-while-working", keyed)).toBe(false)
  expect(awakeOn("awake-plugged-in", keyed)).toBe(true)
  // Before the look comes, as the engine says; the look wins once there.
  const said = naming({ while_working: false, plugged_in: true })
  expect(awakeOn("awake-while-working", {}, said)).toBe(false)
  expect(awakeOn("awake-plugged-in", {}, said)).toBe(true)
  const defaults = { "awake-plugged-in": setting(false, "defaults") }
  expect(awakeOn("awake-plugged-in", defaults, said)).toBe(false)
  // An engine before it, or one that says it otherwise, says nothing.
  expect(awakeSaid(naming())).toBeUndefined()
  expect(awakeSaid(naming({ while_working: "yes", plugged_in: true }))).toBe(
    undefined
  )
  expect(awakeSaid(null)).toBeUndefined()
  expect(awakeOn("awake-while-working", {}, naming())).toBe(true)
})

test("a switch shows what the Person set until its file says otherwise, and Banda's own takes the line out", () => {
  const line = setting(false)
  expect(shownOn(false, line)).toBe(false)
  // Written, and the file not heard yet: as it was set.
  const wrote = { to: line, was: false, on: true }
  expect(shownOn(false, line, wrote)).toBe(true)
  // The file heard: as it says, whatever was set.
  expect(shownOn(true, setting(true), wrote)).toBe(true)
  expect(shownOn(true, setting(true), { ...wrote, on: false })).toBe(true)
  // Heard again as it was, by hand or from another machine: as the file
  // says, not as the Person set it before.
  expect(shownOn(false, setting(false), wrote)).toBe(false)
  // Nothing heard of the file, as before the look comes: as it was set,
  // while what the engine said is still what it said then.
  const unheard = { ...wrote, to: undefined }
  expect(shownOn(false, undefined, unheard)).toBe(true)
  expect(shownOn(true, undefined, { ...unheard, on: false })).toBe(true)
  // Banda's own value takes the Person's line out; the other is written.
  expect(awakeValue("awake-plugged-in", true)).toBe(true)
  expect(awakeValue("awake-plugged-in", false)).toBeNull()
  expect(awakeValue("awake-while-working", false)).toBe(false)
  expect(awakeValue("awake-while-working", true)).toBeNull()
})

test("this machine's switches say what each does, and its lid as its system does it", () => {
  expect(AWAKE_ROWS.map((row) => [row.title, row.about("arc")])).toEqual([
    [
      "Stay awake while Agents work",
      "arc does not sleep by itself while a Turn runs here, and for 10 minutes after. Its screen sleeps as usual.",
    ],
    [
      "Stay awake while plugged in",
      "While on power, arc never sleeps by itself, so other machines can reach it.",
    ],
  ])
  expect(lidWords("m1pro", "macOS 26.1")).toBe(
    "A closed lid still sleeps m1pro. Banda does not change its settings."
  )
  for (const system of ["Arch Linux", "Windows 11 Pro", undefined, 42])
    expect(lidWords("arc", system)).toBe(
      "A closed lid does what arc's own settings say. Banda does not change them."
    )
})

test("another machine's switch is set there while it is live, as its engine says, and is off and still while it is away", () => {
  const mac = naming(
    { while_working: true, plugged_in: true },
    { battery: true, system: "macOS 26.1" }
  )
  expect(pluggedInThere("m1pro", true, mac)).toEqual({
    on: true,
    can: true,
    about: "Set on m1pro, in its machine.toml. A closed lid still sleeps it.",
  })
  const linux = naming(
    { while_working: true, plugged_in: false },
    { battery: true, system: "Arch Linux" }
  )
  expect(pluggedInThere("arc", true, linux)).toEqual({
    on: false,
    can: true,
    about:
      "Set on arc, in its machine.toml. A closed lid does what its own settings say.",
  })
  // No battery, no lid.
  const server = naming({ while_working: true, plugged_in: true })
  expect(pluggedInThere("devbox", true, server).about).toBe(
    "Set on devbox, in its machine.toml."
  )
  // Away: off, and not to be turned, whatever it said before.
  expect(pluggedInThere("m1pro", false, mac)).toEqual({
    on: false,
    can: false,
    about: "Set it on m1pro when it is back.",
  })
  // Asked, and no answer yet.
  expect(pluggedInThere("m1pro", true, undefined)).toEqual({
    on: false,
    can: false,
    about: "Set on m1pro, in its machine.toml.",
  })
  // A Banda there from before it, or one that refused.
  for (const said of [naming(), null])
    expect(pluggedInThere("m1pro", true, said)).toEqual({
      on: false,
      can: false,
      about: "Update Banda on m1pro to set it here.",
    })
})

test("another machine says why it is awake under its Battery, or on its own as Awake where it has none", () => {
  const battery = { percent: 42, charging: false, on_power: false, left: 122 }
  expect(powerRow({ battery, awake: "working" }, 2)).toEqual({
    key: "battery",
    title: "Battery",
    about: "Kept awake: 2 Agents work there.",
  })
  // A desktop, a server: the same line, as Awake.
  expect(powerRow({ awake: "working" }, 2)).toEqual({
    key: "awake",
    title: "Awake",
    about: "Kept awake: 2 Agents work there.",
  })
  expect(powerRow({ awake: "plugged-in" }, 0)?.about).toBe(
    "Kept awake: plugged in, its switch on."
  )
  // Held by nothing: it says so, as its hover does.
  expect(powerRow({ awake: null }, 0)).toEqual({
    key: "awake",
    title: "Awake",
    about: "Sleeps by itself when idle.",
  })
  // Before its engine says it, from one older than it, or away: none.
  expect(powerRow(undefined, 2)).toBeUndefined()
})

test("a machine with no Banda says what Install would put there", () => {
  expect(
    testWords(
      {
        state: "missing",
        system: "Ubuntu 24.04",
        arch: "x86_64",
        version: "0.1.0-dev.642",
      },
      "devbox"
    )
  ).toEqual({
    found: true,
    title: "Found devbox · Ubuntu 24.04 · x64",
    detail:
      "No Banda there yet. Banda dev.642 is put in devbox's own folder; it then updates itself.",
  })
  expect(
    testWords(
      { state: "missing", system: null, arch: "arm64", version: "0.2.0" },
      "m1"
    ).title
  ).toBe("Found m1 · arm64")
})

test("Install's steps are its lines in words, the last still running", () => {
  const said = [
    "machine linux x86_64 Ubuntu 24.04",
    "version 0.1.0-dev.642",
    "downloading banda-dev-0.1.0-dev.642-engine-linux-x86_64.tar.gz 68123456",
  ]
  expect(installSteps(said, "devbox")).toEqual([
    { words: "Downloading dev.642 (68 MB), on devbox", done: false },
  ])
  expect(
    installSteps(
      [...said, "checked banda-dev-0.1.0-dev.642-engine-linux-x86_64.tar.gz"],
      "devbox"
    )
  ).toEqual([
    { words: "Downloaded dev.642 (68 MB), on devbox", done: true },
    { words: "Checked", done: true },
    { words: "Putting it in place", done: false },
  ])
  expect(
    installSteps(
      [
        ...said,
        "checked banda-dev-0.1.0-dev.642-engine-linux-x86_64.tar.gz",
        "installed 0.1.0-dev.642 /home/roma/.local/share/banda-dev/engine/0.1.0-dev.642",
      ],
      "devbox"
    ).at(-1)
  ).toEqual({ words: "Starting its engine", done: false })
  expect(
    installSteps(
      [
        "version 0.1.0-dev.642",
        "present 0.1.0-dev.642 /home/r/.local/share/banda-dev/engine/0.1.0-dev.642",
      ],
      "devbox"
    )
  ).toEqual([
    { words: "dev.642 is on devbox already", done: true },
    { words: "Starting its engine", done: false },
  ])
})

test("a terminal's line keeps each argument whole, quoting only what is not plain", () => {
  expect(
    shellLine(["-t", "-o", "LogLevel=INFO", "--", "roma@devbox", "claude"])
  ).toBe("-t -o LogLevel=INFO -- roma@devbox claude")
  expect(shellLine(["my box", "it's"])).toBe(`'my box' 'it'\\''s'`)
})
