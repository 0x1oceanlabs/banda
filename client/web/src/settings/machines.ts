/**
 * Settings → Machines' own rules and words (ADR 0095): the ten icons in
 * the picker's order, how Add numbers a name another machine shown has
 * and moves a server's icon on (decision 3), what a machine's state, its
 * build and a Test say, when a machine stays awake and what its lid does
 * (ADR 0097), and what the Person's acts show while several run. Its
 * state's words are Settings' own small list; the sidebar's label keeps
 * its own (`HostWords`). Pure, so plain tests cover it.
 */
import type { Awake, MachineIcon, Named } from "@banda/contract/machines"
import type { Setting } from "@banda/contract/settings"
import { cleanNamed, cleanText } from "@banda/ui/hooks/use-status"
import { problem } from "@banda/ui/lib/words"
import { type HostState, type HostTest, otherBuild } from "@banda/core"
import { ELSEWHERE } from "../boot"

/** The ten icons, in the picker's order (decision 1). */
export const ICONS: readonly MachineIcon[] = [
  "laptop",
  "desktop",
  "tower",
  "server",
  "database",
  "storage",
  "router",
  "vm",
  "phone",
  "tablet",
]

/** What each icon is for, as the picker's tooltip says it. */
export const ICON_WORDS: Readonly<Record<MachineIcon, string>> = {
  laptop: "A laptop",
  desktop: "A desktop, a Mac mini, an iMac",
  tower: "A tower",
  server: "A server",
  database: "A database's server",
  storage: "A NAS",
  router: "A router, a Raspberry Pi",
  vm: "A VM, a cloud host",
  phone: "A phone",
  tablet: "A tablet",
}

/** The most characters a machine's name has. */
export const NAME_MOST = 16

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * `name`, numbered when a machine shown has it already (`taken`), as two
 * VMs both "Cloud": the first number free from 2, "Cloud 2", then "Cloud
 * 3". Names are the same whatever their case. A number that would take
 * it past 16 characters cuts the name before it.
 */
export function numbered(name: string, taken: readonly string[]): string {
  if (!taken.some((one) => same(one, name))) return name
  for (let n = 2; ; n++) {
    const tail = ` ${n}`
    const base = [...name]
      .slice(0, NAME_MOST - tail.length)
      .join("")
      .trimEnd()
    const next = `${base}${tail}`
    if (!taken.some((one) => same(one, next))) return next
  }
}

/** The icons a new server moves on through, in order (decision 3). */
const SERVERS: readonly MachineIcon[] = ["server", "tower", "database"]

/**
 * The icon Add gives a new machine whose own is `icon`, past the icons of
 * the machines shown (`taken`): a server, when one shown is a server
 * already, moves on to the tower, then the database, the first free;
 * with all three taken it stays a server. Any other icon stays: two
 * laptops keep one icon, and their names tell them apart.
 */
export function movedIcon(
  icon: MachineIcon,
  taken: readonly MachineIcon[]
): MachineIcon {
  if (icon !== "server" || !taken.includes("server")) return icon
  return SERVERS.find((one) => !taken.includes(one)) ?? icon
}

/** What Add writes on a new machine, and why. */
export type Settled = {
  /** Its name and icon once Add has written them; its own, where
   * nothing shown has them. */
  named: Named
  /** The name it had, when a machine shown has it too and it is
   * numbered. */
  sameName?: string
  /** The name of the machine shown whose icon it had, when its icon
   * moves on. */
  sameIcon?: string
}

/** What Add makes of a new machine that names itself `found`, beside the
 * machines shown (`shown`: this one and the others): its name numbered
 * and its icon moved on, as each clashes (decision 3). */
export function settle(found: Named, shown: readonly Named[]): Settled {
  const name = numbered(
    found.name,
    shown.map((one) => one.name)
  )
  const icon = movedIcon(
    found.icon,
    shown.map((one) => one.icon)
  )
  const holder = shown.find((one) => one.icon === found.icon)
  return {
    named: { name, icon },
    ...(name !== found.name && { sameName: found.name }),
    ...(icon !== found.icon && holder && { sameIcon: holder.name }),
  }
}

/** What Add's Connect says it will write on the new machine, a line for
 * each change; none when nothing clashes. */
export function settleWords({ named, sameName, sameIcon }: Settled): string[] {
  return [
    sameName !== undefined &&
      `${sameName} is taken, so Add names the new machine ${named.name} and writes that on it.`,
    sameIcon !== undefined &&
      `${sameIcon} has the server icon, so Add gives the new machine the ${named.icon}.`,
  ].filter((line): line is string => line !== false)
}

/** What Add says once it has added the machine `name`, as Connect found
 * it, and written on it what clashed (`settled`; none while it waits for
 * its first welcome), or why that was not written (`failed`). */
export function addedWords(
  name: string,
  settled?: Settled,
  failed?: string
): string {
  if (!settled) return `Added ${name}.`
  const { named, sameName, sameIcon } = settled
  const written = [
    sameName !== undefined && `the name ${named.name}`,
    sameIcon !== undefined && `the ${named.icon} icon`,
  ].filter(Boolean)
  if (written.length === 0) return `Added ${named.name}.`
  if (failed !== undefined)
    return `Added ${sameName ?? named.name}, but Banda could not write ${written.join(" and ")} on it: ${failed}`
  return `Added ${named.name}. Written on it: ${written.join(" and ")}. Change it in its row.`
}

/** A machine's state in a word or two, on its row in Settings. */
export function stateWords(state: HostState): string {
  switch (state.state) {
    case "connecting":
      return "connecting"
    case "signin":
      return "sign in to Tailscale"
    case "live":
      return otherBuild(state) ? "live · other build" : "live · same build"
    case "away":
      return "away"
    case "stopped":
      return "stopped"
    case "refused":
      return "refused"
  }
}

type Build = { build: string | null; version: string | null }

/** A build as its words: `dev.421`, a version's, else its build's. */
const short = ({ build, version }: Build) =>
  version === null
    ? (build?.slice(0, 7) ?? "?")
    : (/-(dev\.\d+)$/.exec(version)?.[1] ?? version)

const sameBuild = (a: Build, b: Build) =>
  a.build === b.build && a.version === b.version

/** A live machine's build beside this window's: "dev.421, same as here",
 * or both (`otherBuild`); none while it is not live, as only then is it
 * known. */
export function buildWords(state: HostState): string | undefined {
  if (state.state !== "live") return undefined
  return otherBuild(state) ?? `${short(state)}, same as here`
}

/** Why another machine's name and icon cannot be changed now: only its
 * engine writes them, and only while it is live. */
export const renameWords = (name: string) => `Rename ${name} when it is back`

/** Why whether another machine stays awake on power cannot be set now, as
 * its name cannot (ADR 0097). */
export const awayWords = (name: string) => `Set it on ${name} when it is back`

/** The name and icon a Test found the machine has, cleaned again as a
 * welcome's are, `name` where it says an empty one; none from a banda
 * before them, or where nothing was found. Main cleaned them already
 * (ADR 0095, decision 2): the page draws no name it has not cleaned
 * itself. */
export function foundNamed(test: HostTest, name: string): Named | undefined {
  return test.state === "found" && test.named
    ? cleanNamed(test.named, name)
    : undefined
}

/** The most characters a machine's model or system shows. */
const FACT_MOST = 40

/** What a machine says it is, its model and its system, each cleaned
 * as its name is, on one line; empty where it says neither. */
export const factsWords = (said: readonly unknown[]): string =>
  said
    .map((one) => cleanText(one, FACT_MOST))
    .filter(Boolean)
    .join(" · ")

/**
 * What a Test, or Add's Connect, found, named `name` where the machine
 * says no name of its own: found, with its system, cleaned again as its
 * name is, and its banda's build; Tailscale's sign-in; or why not, in the
 * window's words.
 */
export function testWords(
  test: HostTest,
  name: string
): { found: boolean; title: string; detail?: string } {
  switch (test.state) {
    case "found": {
      const said = factsWords([test.system])
      const system = said ? ` · ${said}` : ""
      const build = sameBuild(test.banda, test.own)
        ? "same build"
        : `${short(test.own)} here`
      return {
        found: true,
        title: `Found ${foundNamed(test, name)?.name ?? name}${system}`,
        detail: `banda ${short(test.banda)}, ${build}`,
      }
    }
    case "signin":
      return { found: false, title: "Sign in to Tailscale to reach it" }
    case "away":
      return { found: false, title: `No answer: ${test.why}` }
    case "refused":
      return { found: false, title: `Cannot use it: ${test.why}` }
  }
}

/** The keys of `machine.toml` that say when a machine stays awake, each
 * with Banda's own value: while its Agents work, on; while it is plugged
 * in, off (ADR 0097, decisions 1 and 2). */
export const AWAKE = {
  "awake-while-working": true,
  "awake-plugged-in": false,
} as const

export type AwakeKey = keyof typeof AWAKE

/** Each key as `machines.get` names it, in its `awake`. */
const SAID: Readonly<Record<AwakeKey, keyof Awake>> = {
  "awake-while-working": "while_working",
  "awake-plugged-in": "plugged_in",
}

/** This machine's switches, under its name, with what each says of the
 * machine `name`. */
export const AWAKE_ROWS: readonly {
  key: AwakeKey
  title: string
  about: (name: string) => string
}[] = [
  {
    key: "awake-while-working",
    title: "Stay awake while Agents work",
    about: (name) =>
      `${name} does not sleep by itself while a Turn runs here, and for 10 minutes after. Its screen sleeps as usual.`,
  },
  {
    key: "awake-plugged-in",
    title: "Stay awake while plugged in",
    about: (name) =>
      `While on power, ${name} never sleeps by itself, so other machines can reach it.`,
  },
]

/** What an engine's `machines.get` (`naming`) says of when its machine
 * stays awake; none from an engine before ADR 0097, which says nothing of
 * it, or one that says it otherwise. */
export function awakeSaid(naming: unknown): Awake | undefined {
  const { awake } = (
    typeof naming === "object" && naming !== null ? naming : {}
  ) as { awake?: unknown }
  if (typeof awake !== "object" || awake === null) return undefined
  const { while_working, plugged_in } = awake as Partial<
    Record<keyof Awake, unknown>
  >
  return typeof while_working === "boolean" && typeof plugged_in === "boolean"
    ? { while_working, plugged_in }
    : undefined
}

/**
 * Whether `key` of this machine is on: as the look reads its
 * `machine.toml` (`keyed`), so a change by hand shows at once; else as its
 * engine said in `machines.get` (`naming`), as before the look comes;
 * else Banda's own.
 */
export function awakeOn(
  key: AwakeKey,
  keyed: Readonly<Record<string, Setting>> | undefined,
  naming?: unknown
): boolean {
  const looked = keyed?.[key]?.value
  if (typeof looked === "boolean") return looked
  return awakeSaid(naming)?.[SAID[key]] ?? AWAKE[key]
}

/** What the Person last set a switch to (`on`), against what was heard of
 * its file then (`to`: the look's line, or the other machine's answer),
 * which said `was`. */
export type Wrote = {
  readonly to: unknown
  readonly was: boolean
  readonly on: boolean
}

/**
 * A switch the Person set: as they set it while what is heard of its file
 * (`heard`) is still what they set it against and says what it said then,
 * as the file is heard a moment after it is written; else as the file
 * says now (`said`). Anything heard since says the file afresh, so a
 * change by hand back to what it was shows too.
 */
export const shownOn = (
  said: boolean,
  heard: unknown,
  wrote?: Wrote
): boolean =>
  wrote !== undefined && wrote.to === heard && wrote.was === said
    ? wrote.on
    : said

/** What `machine.toml` gets as the Person turns `key` `on`: none where
 * that is Banda's own, which takes the line out; else the value. */
export const awakeValue = (key: AwakeKey, on: boolean): boolean | null =>
  on === AWAKE[key] ? null : on

/** Whether a machine runs macOS, as `machines.get` says its system:
 * "macOS 26.1". */
const onMac = (system: unknown) =>
  typeof system === "string" && /^macOS\b/.test(system)

/** What a closed lid does to this machine, `name`, which has a battery,
 * as its `system` is: a Mac's sleeps it, whatever holds it awake; Linux's
 * and Windows' do what their own settings say. Banda changes neither
 * (ADR 0097, decision 4). */
export const lidWords = (name: string, system?: unknown): string =>
  onMac(system)
    ? `A closed lid still sleeps ${name}. Banda does not change its settings.`
    : `A closed lid does what ${name}'s own settings say. Banda does not change them.`

/**
 * "Stay awake while plugged in" in the row of another machine, `name`
 * (ADR 0097, decision 2): whether it is on, whether the Person can turn
 * it, and what the row says. It is set there, through its engine, so only
 * while it is `live`, and off-looking otherwise; `naming` is what its
 * `machines.get` answered, `undefined` while it is asked, `null` where it
 * refused. Its lid is named where it has a battery, as its system is.
 */
export function pluggedInThere(
  name: string,
  live: boolean,
  naming: unknown
): { on: boolean; can: boolean; about: string } {
  if (!live) return { on: false, can: false, about: `${awayWords(name)}.` }
  const set = `Set on ${name}, in its machine.toml.`
  if (naming === undefined) return { on: false, can: false, about: set }
  const said = awakeSaid(naming)
  if (!said)
    return {
      on: false,
      can: false,
      about: `Update Banda on ${name} to set it here.`,
    }
  const { battery, system } = naming as { battery?: unknown; system?: unknown }
  const lid =
    battery !== true
      ? ""
      : onMac(system)
        ? " A closed lid still sleeps it."
        : " A closed lid does what its own settings say."
  return { on: said.plugged_in, can: true, about: `${set}${lid}` }
}

/** One of the Person's acts while it runs, with what it is doing in
 * words. An act is known by itself, not by its words, as two of them
 * may say the same. */
export type Act = { readonly words: string }

/** The Person's acts running in one part of Settings, oldest first, and
 * what went wrong in Banda's words until the next starts. Acts overlap,
 * as Enter in a field while a Test runs, so one that ends leaves the
 * others running. */
export type Acts = {
  readonly running: readonly Act[]
  readonly problem?: string
}

/** No act running, and nothing gone wrong. */
export const NO_ACTS: Acts = { running: [] }

/** `act` starts, the latest running, and what went wrong before goes. */
export const started = (acts: Acts, act: Act): Acts => ({
  running: [...acts.running, act],
})

/** `act` ends, the others running on; why it failed (`failed`) shows
 * until the next act starts, else what went wrong before stays. */
export const ended = (acts: Acts, act: Act, failed?: string): Acts => ({
  running: acts.running.filter((one) => one !== act),
  problem: failed ?? acts.problem,
})

/** What a part of Settings shows of its acts: busy while any runs, what
 * the latest still running is doing (`doing`), and what went wrong. */
export const shownActs = (
  acts: Acts
): { busy: boolean; doing?: string; problem?: string } => ({
  busy: acts.running.length > 0,
  doing: acts.running.at(-1)?.words,
  problem: acts.problem,
})

/** Words meant for the Person, which `failedWords` shows as they are. */
export class Told extends Error {}

/** What went wrong, in Banda's words: Settings' own (`Told`), the
 * window's without the desktop, main's refusal over the bridge without
 * Electron's words around it, or an engine's. */
export function failedWords(error: unknown): string {
  if (error instanceof Told) return error.message
  const words = error instanceof Error ? error.message : ""
  if (words === ELSEWHERE) return words
  const main = /^Error invoking remote method '[^']*': (?:\w+: )?(.*)$/s.exec(
    words
  )
  return main?.[1] ?? problem(error)
}
