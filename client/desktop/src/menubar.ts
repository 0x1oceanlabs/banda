/**
 * Banda in macOS's menu bar (ADR 0086, decision 4; the accepted mock,
 * mac-menubar-v1): with no window open, Banda.app keeps running with no
 * Dock icon, only its icon in the menu bar. The icon is Banda's mark,
 * whose hat says who works and who waits on this Mac, with one number
 * beside it: how many wait for the Person, else how many work. Its menu,
 * a plain macOS menu built again on each change, lists them, what waits
 * first, then what works, each row opening its Thread; then Open Banda,
 * the version and Quit Banda. Only this Mac's Threads: Quit stops only
 * its engine.
 *
 * All of it comes from one line of `banda status --follow` (status.ts),
 * none while no line came or the follower died. This is the part that
 * says what the icon and the menu are for a line; tray.ts draws them.
 * Linux and Windows have no menu bar icon in this step (`hasMenuBar`).
 */
import type { EngineStatus } from "@banda/contract"
import type { CountedAs } from "@banda/contract/agents"

/** Whether Banda lives in the menu bar here: on macOS alone, for now. */
export function hasMenuBar(platform: NodeJS.Platform): boolean {
  return platform === "darwin"
}

/**
 * The icon's sign, as the hat draws it: a square at rest; a circle while
 * Agents work; a triangle, lit, while one asks the Person or failed; a
 * square with happy eyes while what waits is done; asleep and dimmed
 * while the engine does not answer.
 */
export type Sign = "rest" | "working" | "asking" | "done" | "asleep"

/** What the menu bar shows: the sign, the number beside it, and the
 * same in words, for the tooltip and a screen reader. */
export type Look = { sign: Sign; count: string; said: string }

/** The icon for `status`, none when no line came or the follower died. */
export function lookOf(status: EngineStatus | null): Look {
  if (!status?.running) return { sign: "asleep", count: "", said: "Offline" }
  const agents = status.agents
  if (agents && agents.waiting > 0) {
    const count = String(agents.waiting)
    return {
      sign: agents.asking > 0 ? "asking" : "done",
      count,
      said: `${count} wait for you`,
    }
  }
  if (agents && agents.working > 0) {
    const count = String(agents.working)
    return { sign: "working", count, said: `${count} working` }
  }
  return { sign: "rest", count: "", said: "Nothing runs" }
}

/** An icon's file in `menu-bar/` (icons/menu-bar/draw.mjs), and whether
 * macOS draws it in the menu bar's own colour, as a template. */
export type Icon = { file: string; template: boolean }

/** The icon for `sign`, in a menu bar that is `dark` or not: in colour
 * only where the mock shows it, a hat that asks. */
export function iconOf(sign: Sign, dark: boolean): Icon {
  return sign === "asking"
    ? { file: `asking-${dark ? "dark" : "light"}.png`, template: false }
    : { file: `${sign}Template.png`, template: true }
}

/** A row's mark: the menu's own colour for work, colour for the rest. */
export function rowIconOf(state: CountedAs): Icon {
  return state === "working"
    ? { file: "row-workingTemplate.png", template: true }
    : { file: `row-${state}.png`, template: false }
}

/** One item of the menu. */
export type Item =
  | { kind: "heading"; label: string }
  | {
      kind: "thread"
      label: string
      sublabel: string
      state: CountedAs
      project: string
      thread: string
      title: string
    }
  | { kind: "line"; label: string }
  | { kind: "separator" }
  | { kind: "open"; label: string }
  | { kind: "quit"; label: string }

/** How each state says itself under its row, as the mark's words. */
const STATE_WORDS: Record<CountedAs, string> = {
  working: "Working",
  asking: "Asks you",
  failed: "Failed",
  done: "Done",
}

/** The longest title a row shows whole. */
const LONGEST = 44

/** A title cut to `LONGEST`, so the menu stays narrow. */
function cut(title: string): string {
  return title.length > LONGEST ? `${title.slice(0, LONGEST - 1)}…` : title
}

/** A version as the menu names it: a Dev by its number (`dev.458`), a
 * Stable whole. */
export function shortOf(version: string): string {
  return /-(dev\.\d+)$/.exec(version)?.[1] ?? version
}

/**
 * The menu for `status`, of the Banda named `name` (Banda, Banda Dev),
 * whose own version is `version` where the engine says none: who waits
 * and who works, then Open Banda, the version and Quit Banda.
 */
export function menuOf(
  status: EngineStatus | null,
  name: string,
  version: string
): Item[] {
  const items: Item[] = []
  const agents = status?.running ? status.agents : undefined
  if (!status?.running) {
    items.push({ kind: "line", label: "Banda's engine does not answer" })
  } else if (agents && agents.threads.length === 0) {
    items.push({ kind: "line", label: "Nothing runs" })
  } else if (agents) {
    let heading: string | undefined
    for (const one of agents.threads) {
      const now = one.state === "working" ? "Working" : "Wait for you"
      if (now !== heading) items.push({ kind: "heading", label: now })
      heading = now
      items.push({
        kind: "thread",
        label: cut(one.title),
        sublabel: `${one.project_name} · ${STATE_WORDS[one.state]}`,
        state: one.state,
        project: one.project,
        thread: one.thread,
        title: one.title,
      })
    }
  }
  if (items.length > 0) items.push({ kind: "separator" })
  items.push(
    { kind: "open", label: "Open Banda" },
    { kind: "separator" },
    {
      kind: "line",
      label: `${name} ${shortOf(status?.version ?? version)}`,
    },
    { kind: "quit", label: "Quit Banda" }
  )
  return items
}

/** A line `banda status` printed, as the status it says; none for one
 * that is not. */
export function statusOf(line: string): EngineStatus | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  return typeof parsed === "object" &&
    parsed !== null &&
    typeof (parsed as { running?: unknown }).running === "boolean"
    ? (parsed as EngineStatus)
    : null
}
