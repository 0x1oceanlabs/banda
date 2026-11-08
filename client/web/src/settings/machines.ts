/**
 * Settings → Machines' own rules and words (ADR 0095): the ten icons in
 * the picker's order, how Add numbers a name another machine shown has
 * and moves a server's icon on (decision 3), and what a machine's state,
 * its build and a Test say. Its state's words are Settings' own small
 * list; the sidebar's label keeps its own (`HostWords`). Pure, so plain
 * tests cover it.
 */
import type { MachineIcon, Named } from "@banda/contract/machines"
import { cleanNamed, cleanText } from "@banda/ui/hooks/use-status"
import { problem } from "@banda/ui/lib/words"
import { otherBuild } from "../calls/hosts"
import type { HostState, HostTest } from "../host"
import { ELSEWHERE } from "../window/device"

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
