/**
 * What the update widget says of each machine (ADR 0119, decision 7):
 * one row each, this machine's too, from what its engine says on
 * `updates.state`, and the bar's word over them all and this window's
 * app. Pure, so plain tests cover it; Update.tsx draws it, and Settings →
 * Machines draws the same line.
 */
import type { MachineIcon } from "@banda/contract/machines"
import type { UpdateState, Waits } from "@banda/contract/updates"
import type { Update } from "@banda/core"
import { ago } from "@banda/ui/lib/words"
import { shortOf } from "./updating"

/** A machine as the widget shows it. */
export type MachineUpdates = {
  /** Its key in `hosts.toml`; none for this machine. */
  host?: string
  name: string
  icon: MachineIcon
  /** The window does not reach it now. */
  away: boolean
  /** What its engine last said, kept while it is away; none before it
   * said anything. */
  said?: UpdateState
  /** Its engine answers no `updates.state`: one older than ADR 0119's
   * step 3. */
  refused?: boolean
}

/** What a machine's row is. */
export type RowKind =
  /** It runs the newest, or has not looked yet. */
  | "ok"
  /** Its new engine downloads. */
  | "taking"
  /** A new engine is in place, and the engine moves onto it once
   * nothing runs. */
  | "waits"
  /** A new engine is in place, and its machine.toml says "ask". */
  | "ask"
  | "failed"
  | "away"
  /** It takes nothing by itself, or says nothing of its updates. */
  | "off"

/** A machine's row: its version, where it goes, what it says, and how
 * far its download is. */
export type Row = {
  kind: RowKind
  /** The version it runs, short. */
  from?: string
  /** The version it goes to, short, while one is on its way or ready. */
  to?: string
  /** What the row says under its name. */
  say?: string
  /** The download's share, 0 to 1, and its words: `31 of 68 MB`. */
  share?: number
  size?: string
  /** Restart now restarts it at once; none where nothing is ready, or
   * where it moves only as Banda restarts there. */
  restarts: boolean
}

/** Machine `machine`'s row at `now`. */
export function rowOf(machine: MachineUpdates, now: number): Row {
  const { said, name } = machine
  const from = said && shortOf(said.running)
  if (machine.away)
    return {
      kind: "away",
      from,
      say: "Updates itself once it is back.",
      restarts: false,
    }
  if (machine.refused)
    return {
      kind: "off",
      say: `Its Banda is older than its own updates: update it on ${name} once.`,
      restarts: false,
    }
  if (!said) return { kind: "ok", restarts: false }
  if (said.taking) {
    const { version, share, size } = said.taking
    return {
      kind: "taking",
      from,
      to: shortOf(version),
      share,
      size: sizeOf(share * size, size),
      restarts: false,
    }
  }
  if (said.ready) {
    const to = shortOf(said.ready)
    const waits = said.waits
    if (waits?.person || said.takes === "ask")
      return {
        kind: "ask",
        from,
        to,
        say: `Ready. ${name} asks before it restarts. ${workingThere(waits)}`,
        restarts: true,
      }
    if (waits?.restart)
      return {
        kind: "waits",
        from,
        to,
        say: `${waits.restart}.`,
        restarts: false,
      }
    return {
      kind: "waits",
      from,
      to,
      say: waitWords(waits, now),
      restarts: true,
    }
  }
  if (said.failed)
    return { kind: "failed", from, say: endWith(said.failed), restarts: false }
  if (said.off)
    return { kind: "off", from, say: endWith(said.off), restarts: false }
  return { kind: "ok", from, say: updatedWords(said, now), restarts: false }
}

/** What a copy in place waits for, as its row says it: "Restarts once 2
 * Threads finish and a terminal closes." */
export function waitWords(waits: Waits | undefined, now: number): string {
  if (!waits) return "Restarts in a moment."
  const what: string[] = []
  if (waits.turns === 1) what.push("its 1 Thread finishes")
  else if (waits.turns > 1) what.push(`${waits.turns} Threads finish`)
  if (waits.terminals === 1) what.push("its terminal closes")
  else if (waits.terminals > 1)
    what.push(`its ${waits.terminals} terminals close`)
  if (waits.typed_until !== undefined && waits.typed_until > now)
    what.push(`no key reaches it until ${clockOf(waits.typed_until)}`)
  if (what.length === 0) return "Restarts in a moment."
  const last = what.pop()!
  return `Restarts once ${what.length > 0 ? `${what.join(", ")} and ${last}` : last}.`
}

/** Whether Agents work on a machine that asks, as its row says it. */
function workingThere(waits: Waits | undefined): string {
  const turns = waits?.turns ?? 0
  if (turns === 0) return "Nothing works there now."
  return turns === 1
    ? "An Agent works there now."
    : `${turns} Agents work there now.`
}

/** When a machine that runs the newest moved onto it, if it did: "Updated
 * 4m ago, between turns." */
function updatedWords(said: UpdateState, now: number): string | undefined {
  const { updated } = said
  if (!updated) return undefined
  const when = ago(updated.at, now)
  const at = when === "now" ? "just now" : `${when} ago`
  return updated.idle ? `Updated ${at}, between turns.` : `Updated ${at}.`
}

/** `12:04`, by this machine's clock. */
function clockOf(at: number): string {
  return new Date(at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** An engine's words as a sentence. */
const endWith = (words: string) => (/[.!?]$/.test(words) ? words : `${words}.`)

/** `31 of 68 MB`. */
function sizeOf(down: number, size: number): string | undefined {
  if (!size) return undefined
  const mb = (bytes: number) => bytes / 1_000_000
  const digits = mb(size) < 10 ? 1 : 0
  return `${mb(down).toFixed(digits)} of ${mb(size).toFixed(digits)} MB`
}

/** What the bar shows over this window's app and every machine: the
 * worst state, in this order (the chosen mock, ADR 0119); `app` where it
 * is this window's app's own, which the bar then words as before. */
export type Worst = { app?: true } & (
  | { kind: "failed"; pill: string }
  | { kind: "updated"; pill: string }
  | { kind: "waits"; pill: string }
  | { kind: "ready"; pill: string }
  | { kind: "downloading"; share: number; version?: string }
  | { kind: "looking" }
  | { kind: "quiet" }
)

/** The bar's word over `app` and `machines`' `rows`. */
export function worstOf(
  app: Update | undefined,
  rows: readonly { machine: MachineUpdates; row: Row }[]
): Worst {
  const failed = rows.find(({ row }) => row.kind === "failed")
  if (app?.state === "failed")
    return { kind: "failed", pill: "window", app: true }
  if (failed) return { kind: "failed", pill: failed.machine.name }
  if (app?.state === "updated")
    return { kind: "updated", pill: shortOf(app.have), app: true }
  const waits = rows.find(({ row }) => row.kind === "waits")
  if (waits) return { kind: "waits", pill: `${waits.machine.name} waits` }
  if (app?.state === "ready" || app?.state === "out")
    return { kind: "ready", pill: shortOf(app.version), app: true }
  const asks = rows.find(({ row }) => row.kind === "ask")
  if (asks?.row.to) return { kind: "ready", pill: asks.row.to }
  if (app?.state === "downloading")
    return { kind: "downloading", share: app.share, app: true }
  const taking = rows.find(({ row }) => row.kind === "taking")
  if (taking)
    return {
      kind: "downloading",
      share: taking.row.share ?? 0,
      version: taking.row.to,
    }
  if (app?.state === "looking") return { kind: "looking", app: true }
  return app ? { kind: "quiet", app: true } : { kind: "quiet" }
}

/** Whether the bar shows the widget at all: with something to say, or
 * always for Banda Dev (ADR 0045). */
export const shownOn = (worst: Worst, app: Update | undefined): boolean =>
  worst.kind !== "quiet" || app?.always === true

/** The newest version, as this machine's engine found it on its channel
 * (its engine decides; the window orders no versions), and when its
 * release was out; before its first look, the version this window's app
 * goes to, or runs. */
export function newestOf(
  app: Update | undefined,
  here: MachineUpdates | undefined
): { version: string; published?: number } | undefined {
  const said = here?.said
  if (said?.newest) return { version: said.newest, published: said.published }
  if (app && "version" in app) return { version: app.version }
  return app ? { version: app.have } : undefined
}

/** Whether every machine reached and this window's app run `version`. */
export function allOn(
  version: string,
  app: Update | undefined,
  machines: readonly MachineUpdates[]
): boolean {
  return (
    (!app || app.have === version) &&
    machines.every(
      ({ said, away }) => away || !said || said.running === version
    )
  )
}

/** The latest look of any machine reached, in ms since the epoch. */
export function lookedOf(
  machines: readonly MachineUpdates[]
): number | undefined {
  const looks = machines.flatMap(({ said }) =>
    said?.looked ? [said.looked] : []
  )
  return looks.length > 0 ? Math.max(...looks) : undefined
}

/** The header's corner: "out 20m ago", or "the newest". */
export function outWords(
  newest: { version: string; published?: number } | undefined,
  everyOn: boolean,
  now: number
): string | undefined {
  if (!newest) return undefined
  if (everyOn) return "the newest"
  if (newest.published === undefined) return undefined
  const when = ago(newest.published, now)
  return when === "now" ? "out just now" : `out ${when} ago`
}

/** "Looked 3m ago". */
export function lookedWords(looked: number | undefined, now: number): string {
  if (looked === undefined) return "Not looked yet"
  const when = ago(looked, now)
  return when === "now" ? "Looked just now" : `Looked ${when} ago`
}

/** What machine.toml's `updates` says, in words: "When idle". */
export const TAKES = {
  "when-idle": "When idle",
  ask: "Ask",
  off: "Off",
} as const
