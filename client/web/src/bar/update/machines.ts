/**
 * What the update widget says of each machine (ADR 0131, decision 1):
 * one row each, one word at its right, at most one act, and a second line
 * only when the Person needs a why. This machine's row holds this
 * window's app too: one Update does both. Pure, so plain tests cover it;
 * Update.tsx draws it, and Settings → Machines draws the same line.
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
  /** A new version downloads. */
  | "taking"
  /** A new version is in place, and one Update takes it. */
  | "ready"
  /** A new version is in place, and the machine takes it by itself once
   * nothing runs. */
  | "waits"
  | "failed"
  | "away"
  /** It takes nothing by itself. */
  | "off"

/** What a row's one button does. */
export type Act =
  /** Takes what is ready: this window's app, and the machine's engine. */
  | "update"
  /** Looks again: after a failure. */
  | "retry"

/** A machine's row. */
export type Row = {
  kind: RowKind
  /** The version it runs, short. */
  from?: string
  /** The version it goes to, short, while one is on its way or ready. */
  to?: string
  /** The one word at its right; none where its button stands. */
  status?: string
  /** The line under its name, only when it needs one. */
  why?: string
  /** What went wrong, as the program said it, behind Details. */
  details?: string
  /** Its one button. */
  act?: Act
  /** A download's share, 0 to 1, and its words: `31 of 68 MB`. */
  share?: number
  size?: string
  /** The command that installs this window's app (macOS, brew). */
  command?: string
  /** This window's app is part of what its Update takes. */
  app?: boolean
  /** The engine moves on its Update; else only the app restarts. */
  engine?: boolean
}

/** Machine `machine`'s row at `now`; this window's `app` on this
 * machine's. */
export function rowOf(machine: MachineUpdates, now: number, app?: Update): Row {
  const engine = engineRow(machine, now)
  return app ? withApp(engine, app) : engine
}

function engineRow(machine: MachineUpdates, now: number): Row {
  const { said, name } = machine
  const from = said && shortOf(said.running)
  if (machine.away) return { kind: "away", from, status: "Away" }
  if (machine.refused)
    return {
      kind: "off",
      status: "Update by hand",
      why: `Banda on ${name} is too old to update itself: update it there once.`,
    }
  if (!said) return { kind: "ok" }
  if (said.taking) {
    const { version, share, size } = said.taking
    return {
      kind: "taking",
      from,
      to: shortOf(version),
      share,
      size: sizeOf(share * size, size),
      status: sizeOf(share * size, size) ?? "Updating",
    }
  }
  if (said.ready) {
    const to = shortOf(said.ready)
    const waits = said.waits
    if (waits?.person || said.takes === "ask")
      return { kind: "ready", from, to, act: "update", engine: true }
    // It moves only as Banda restarts there: this window's Update does.
    if (waits?.restart)
      return {
        kind: "waits",
        from,
        to,
        status: "Ready",
        why: "Updates when Banda restarts.",
      }
    return {
      kind: "waits",
      from,
      to,
      status: waitingWord(waits, now),
      why: waitWords(waits, now),
    }
  }
  if (said.failed)
    return {
      kind: "failed",
      from,
      status: "Couldn't update",
      why: plainOf(said.failed),
      details: said.failed,
      act: "retry",
    }
  if (said.off)
    return { kind: "off", from, status: "Off", why: endWith(said.off) }
  return { kind: "ok", from, status: "Up to date" }
}

/** This machine's row with this window's app in it: one Update takes
 * both, the app at once and the engine once nothing runs. */
function withApp(engine: Row, app: Update): Row {
  const have = shortOf(app.have)
  switch (app.state) {
    case "failed":
      return {
        ...engine,
        kind: "failed",
        from: engine.from ?? have,
        status: "Couldn't update",
        why: plainOf(app.reason),
        details: app.reason,
        act: "retry",
      }
    case "none":
      return app.missed && engine.kind !== "failed"
        ? {
            ...engine,
            kind: "failed",
            from: engine.from ?? have,
            status: "Couldn't update",
            why: plainOf(app.missed),
            details: app.missed,
            act: "retry",
          }
        : engine
    case "downloading":
      return engine.kind === "failed"
        ? engine
        : {
            kind: "taking",
            from: have,
            to: shortOf(app.version),
            share: app.share,
            size: app.size ? sizeOf(app.down ?? 0, app.size) : undefined,
            status: app.size ? sizeOf(app.down ?? 0, app.size) : "Updating",
          }
    case "ready":
      return engine.kind === "failed" || engine.kind === "taking"
        ? engine
        : {
            kind: "ready",
            from: have,
            to: shortOf(app.version),
            act: "update",
            app: true,
            // The engine goes too where it is ready and may move now.
            engine: engine.kind === "ready" || engine.kind === "waits",
          }
    case "out":
      return {
        kind: "ready",
        from: have,
        to: shortOf(app.version),
        status: "Ready",
        why: "Run this in a terminal to update:",
        command: app.command,
      }
    case "updated":
      return engine.kind === "failed" ||
        engine.kind === "taking" ||
        engine.kind === "ready"
        ? engine
        : {
            kind: "ok",
            from: have,
            status: "Up to date",
            why: "Updated just now.",
          }
    default:
      return engine
  }
}

/** The word at a waiting row's right: what holds it. */
function waitingWord(waits: Waits | undefined, now: number): string {
  const turns = waits?.turns ?? 0
  if (turns === 1) return "After 1 Agent"
  if (turns > 1) return `After ${turns} Agents`
  if ((waits?.terminals ?? 0) > 0) return "After terminals"
  if (waits?.typed_until !== undefined && waits.typed_until > now) return "Soon"
  return "Updating"
}

/** What a copy in place waits for, in a line: "Updates by itself once 2
 * Agents finish and its terminal closes." None where nothing holds it. */
export function waitWords(
  waits: Waits | undefined,
  now: number
): string | undefined {
  if (!waits) return undefined
  const what: string[] = []
  if (waits.turns === 1) what.push("its Agent finishes")
  else if (waits.turns > 1) what.push(`${waits.turns} Agents finish`)
  if (waits.terminals === 1) what.push("its terminal closes")
  else if (waits.terminals > 1)
    what.push(`its ${waits.terminals} terminals close`)
  if (waits.typed_until !== undefined && waits.typed_until > now)
    what.push(`no one types there until ${clockOf(waits.typed_until)}`)
  if (what.length === 0) return undefined
  const last = what.pop()!
  return `Updates by itself once ${what.length > 0 ? `${what.join(", ")} and ${last}` : last}.`
}

/**
 * What went wrong, in the Person's words: the program's own text stays
 * behind Details.
 */
export function plainOf(raw: string): string {
  if (/no room|no space|ENOSPC|disk/i.test(raw)) return "Not enough disk space."
  if (/token|hello|forbidden|refused/i.test(raw))
    return "Banda lost touch with itself for a moment."
  if (/sha512|checksum|size|corrupt|broken/i.test(raw))
    return "The download was broken."
  if (
    /network|internet|disconnected|fetch|ENOTFOUND|ECONN|EAI_AGAIN|timed? ?out|offline|unreach|github/i.test(
      raw
    )
  )
    return "Couldn't reach the releases. Check the connection."
  if (/permission|EACCES|EPERM/i.test(raw))
    return "Banda may not write where it keeps its copy."
  return "Something went wrong."
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

/** What the bar's icon shows over every row: the worst first. No pill,
 * no words but its hover. */
export type Worst =
  | { kind: "failed"; name: string }
  | { kind: "updated"; version: string }
  | { kind: "ready"; version?: string }
  | { kind: "downloading"; share: number; version?: string }
  | { kind: "looking" }
  | { kind: "quiet" }

/** The bar's icon over `rows`, with this window's `app`. */
export function worstOf(
  app: Update | undefined,
  rows: readonly { machine: MachineUpdates; row: Row }[]
): Worst {
  const failed = rows.find(({ row }) => row.kind === "failed")
  if (failed) return { kind: "failed", name: failed.machine.name }
  if (app?.state === "failed") return { kind: "failed", name: "this window" }
  if (app?.state === "updated")
    return { kind: "updated", version: shortOf(app.have) }
  const ready = rows.find(
    ({ row }) => row.kind === "ready" || row.kind === "waits"
  )
  if (ready) return { kind: "ready", version: ready.row.to }
  if (app?.state === "ready" || app?.state === "out")
    return { kind: "ready", version: shortOf(app.version) }
  const taking = rows.find(({ row }) => row.kind === "taking")
  if (taking)
    return {
      kind: "downloading",
      share: taking.row.share ?? 0,
      version: taking.row.to,
    }
  if (app?.state === "downloading")
    return {
      kind: "downloading",
      share: app.share,
      version: shortOf(app.version),
    }
  if (app?.state === "looking") return { kind: "looking" }
  return { kind: "quiet" }
}

/** Whether the bar shows the widget at all: with something to say, or
 * always for Banda Dev (ADR 0045). */
export const shownOn = (worst: Worst, app: Update | undefined): boolean =>
  worst.kind !== "quiet" || app?.always === true

/** The popover's title, and the line under it when one helps. */
export function titleOf(
  rows: readonly { machine: MachineUpdates; row: Row }[],
  newest: string | undefined
): { title: string; say?: string } {
  const failed = rows.find(({ row }) => row.kind === "failed")
  if (failed) return { title: `Couldn't update ${failed.machine.name}` }
  const taking = rows.find(({ row }) => row.kind === "taking")
  if (taking?.row.to) return { title: `Updating to ${taking.row.to}` }
  const ready = rows.find(
    ({ row }) => row.kind === "ready" || row.kind === "waits"
  )
  if (ready?.row.to) return { title: `Banda ${ready.row.to} is ready` }
  const reached = rows.filter(({ row }) => row.kind !== "away")
  if (reached.every(({ row }) => row.kind === "ok"))
    return {
      title: "Banda is up to date",
      say:
        newest && reached.length === rows.length
          ? `${shortOf(newest)} on every machine.`
          : undefined,
    }
  return { title: newest ? `Banda ${shortOf(newest)}` : "Banda" }
}

/** The newest version, as this machine's engine found it on its channel;
 * before its first look, the version this window's app goes to, or runs. */
export function newestOf(
  app: Update | undefined,
  here: MachineUpdates | undefined
): string | undefined {
  if (here?.said?.newest) return here.said.newest
  if (app && "version" in app) return app.version
  return app?.have
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

/** "Checked 3 min ago". */
export function lookedWords(looked: number | undefined, now: number): string {
  if (looked === undefined) return "Not checked yet"
  const when = ago(looked, now)
  return when === "now" ? "Checked just now" : `Checked ${when} ago`
}

/** What machine.toml's `updates` says, in words: "When idle". */
export const TAKES = {
  "when-idle": "When idle",
  ask: "Ask",
  off: "Off",
} as const
