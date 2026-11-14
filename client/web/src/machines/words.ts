/**
 * A machine in words, as the Window says it wherever it shows one (ADR
 * 0095; ADR 0098, decision 18): Settings → Machines, a machine's card, a
 * Thread's card and the sidebar foot's machines. Its state, its build,
 * what it says it is, how long it has been out of reach, and how its dot
 * stands. Pure, so plain tests cover it.
 */
import { cleanText } from "@banda/ui/hooks/use-status"
import { short } from "@banda/ui/lib/words"
import { awaySince, type HostState, otherBuild, type Shown } from "@banda/core"

export { THIS_MACHINE } from "@banda/core"

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

/** A banda's build, as an engine says it and its own. */
export type Build = { build: string | null; version: string | null }

/** A build as its words: `dev.421`, a version's, else its build's. */
export const buildName = ({ build, version }: Build) =>
  version === null
    ? (build?.slice(0, 7) ?? "?")
    : (/-(dev\.\d+)$/.exec(version)?.[1] ?? version)

export const sameBuild = (a: Build, b: Build) =>
  a.build === b.build && a.version === b.version

/** A live machine's build beside this window's: "dev.421, same as here",
 * or both (`otherBuild`); none while it is not live, as only then is it
 * known. */
export function buildWords(state: HostState): string | undefined {
  if (state.state !== "live") return undefined
  return otherBuild(state) ?? `${buildName(state)}, same as here`
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

/** Since when a machine is out of the Window's reach, and whether it is
 * stopped there rather than away. */
export type Away = { since: number; stopped?: boolean }

/** How long a machine has been out of reach at `now`, by a card's short
 * steps (ADR 0098, decision 18): "away 12m", "stopped 3m", and in its
 * first minute "away". */
export function awayShort({ since, stopped }: Away, now: number): string {
  const ago = short(since, now)
  const word = stopped ? "stopped" : "away"
  return ago === "now" ? word : `${word} ${ago}`
}

/** How a machine's dot stands in the sidebar's foot: reached; out of
 * reach, away, stopped or reaching it; waiting on its Person to sign in;
 * or refused. */
export type Standing = "live" | "away" | "asks" | "refused"

export function standingOf({ state }: HostState): Standing {
  switch (state) {
    case "live":
      return "live"
    case "signin":
      return "asks"
    case "refused":
      return "refused"
    default:
      return "away"
  }
}

/**
 * What the foot's machines say of host `shown` at `now`, after its name
 * (ADR 0098, decision 18): "live", or "other build"; "connecting"; out of
 * reach, since when it was last heard, as its cards say it, "away 12m";
 * "sign in to Tailscale"; or "refused", why in its tooltip.
 */
export function footWords(shown: Shown, now: number): string {
  const { state } = shown
  switch (state.state) {
    case "live":
      return otherBuild(state) ? "other build" : "live"
    case "away":
    case "stopped": {
      const since = awaySince(shown) ?? now
      return awayShort({ since, stopped: state.state === "stopped" }, now)
    }
    default:
      return stateWords(state)
  }
}
