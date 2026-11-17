/**
 * Banda in macOS's menu bar (ADR 0086, decision 4; the accepted mock,
 * mac-menubar-v1): with no window open, Banda.app keeps running with no
 * Dock icon, only its icon in the menu bar. The icon is Banda's mark,
 * whose hat says who works and who waits on this Mac, with one number
 * beside it: how many wait for the Person, else how many work. Its menu,
 * a plain macOS menu built again as it changes (`menuSetter`), lists
 * them, what waits first, then what works, each row opening its Thread;
 * then Open Banda, the version and Quit Banda. Only this Mac's Threads:
 * Quit stops only its engine.
 *
 * In the tray on Linux and in Windows' notification area it is the same
 * mark and the same menu, as far as they draw them (ADR 0136, proposed in
 * #1871; the mock tray-linux-windows): the sign alone, in the ink of the
 * bar it sits on, its number in the tooltip and in the menu's headings
 * ("Your turn · 2"); and a Thread's row is one line, "title · state",
 * with no Project.
 *
 * All of it comes from one line of `banda status --follow` (status.ts),
 * none while no line came or the follower died. This is the part that
 * says what the icon and the menu are for a line; tray.ts draws them.
 */
import type { EngineStatus } from "@banda/contract"
import type { CountedAs } from "@banda/contract/agents"

/** Whether Banda lives in the menu bar here, or in the tray: on macOS,
 * Linux and Windows. Not on a Linux window that is `headless`, with no
 * screen, as a hidden trial's and a test's: with no tray host on the bus
 * Electron falls back to GTK's icon, and GTK ends the app where it has
 * no display. */
export function hasMenuBar(
  platform: NodeJS.Platform,
  headless: boolean
): boolean {
  if (platform === "linux") return !headless
  return platform === "darwin" || platform === "win32"
}

/**
 * The icon's sign, as the hat draws it: a square at rest; a circle while
 * Agents work; a triangle, lit, while one asks the Person or failed; a
 * square with happy eyes while what waits is done; asleep and dimmed
 * while the engine does not answer.
 */
export type Sign = "rest" | "working" | "asking" | "done" | "asleep"

/** What the menu bar shows: the sign, the number beside it, which only
 * macOS draws, and the same in words, for the tooltip and a screen
 * reader, as the window's logo says them: "3 your turn", "7 at work"
 * (ADR 0098, decision 22). */
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
      said: `${count} your turn`,
    }
  }
  if (agents && agents.working > 0) {
    const count = String(agents.working)
    return { sign: "working", count, said: `${count} at work` }
  }
  return { sign: "rest", count: "", said: "Nothing runs" }
}

/** An icon's file in `menu-bar/` (icons/menu-bar/draw.mjs), and whether
 * macOS draws it in the menu bar's own colour, as a template. */
export type Icon = { file: string; template: boolean }

/** The icon for `sign`, in a bar that is `dark` or not: in colour only
 * where the mock shows it, a hat that asks. macOS colours the rest
 * itself, as templates; Linux and Windows have none, so there each sign
 * is drawn for a light bar and a dark one (`tray/`), a PNG on Linux and
 * an `.ico` on Windows. */
export function iconOf(
  sign: Sign,
  dark: boolean,
  platform: NodeJS.Platform
): Icon {
  const bar = dark ? "dark" : "light"
  if (platform !== "darwin") {
    const kind = platform === "win32" ? "ico" : "png"
    return { file: `tray/${sign}-${bar}.${kind}`, template: false }
  }
  return sign === "asking"
    ? { file: `asking-${bar}.png`, template: false }
    : { file: `${sign}Template.png`, template: true }
}

/** A row's mark: the menu's own colour for work, colour for the rest.
 * Off macOS nothing colours a mark as the menu is, and Banda does not
 * know the menu's colour: a row that works has none there, its word says
 * it. */
export function rowIconOf(
  state: CountedAs,
  platform: NodeJS.Platform
): Icon | null {
  if (state !== "working") return { file: `row-${state}.png`, template: false }
  return platform === "darwin"
    ? { file: "row-workingTemplate.png", template: true }
    : null
}

/** One item of the menu. */
export type Item =
  | { kind: "heading"; label: string }
  | {
      kind: "thread"
      label: string
      /** The line under the row, which only macOS draws. */
      sublabel?: string
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
  woke: "Woke",
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
 * and who works, then Open Banda, the version and Quit Banda. macOS
 * draws a heading and a second line under a row; the menus of Linux and
 * Windows draw neither, so there a heading is a line that cannot be
 * picked, with how many are under it, and a row says its state after its
 * title, without its Project.
 */
export function menuOf(
  status: EngineStatus | null,
  name: string,
  version: string,
  platform: NodeJS.Platform
): Item[] {
  const mac = platform === "darwin"
  const items: Item[] = []
  const agents = status?.running ? status.agents : undefined
  if (!status?.running) {
    items.push({ kind: "line", label: "Banda's engine does not answer" })
  } else if (agents && agents.threads.length === 0) {
    items.push({ kind: "line", label: "Nothing runs" })
  } else if (agents) {
    let heading: string | undefined
    for (const one of agents.threads) {
      const now = one.state === "working" ? "Working" : "Your turn"
      if (now !== heading) {
        const count = now === "Working" ? agents.working : agents.waiting
        items.push(
          mac
            ? { kind: "heading", label: now }
            : { kind: "line", label: `${now} · ${count}` }
        )
      }
      heading = now
      const state = STATE_WORDS[one.state]
      items.push({
        kind: "thread",
        ...(mac
          ? {
              label: cut(one.title),
              sublabel: `${one.project_name} · ${state}`,
            }
          : { label: `${cut(one.title)} · ${state}` }),
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

/**
 * Sets the menu (`set`) as its items change, never while it is open, as
 * setting one closes the one open: what came meanwhile is set as it
 * closes. The same items again set nothing.
 */
export function menuSetter<T>(set: (items: T) => void) {
  let last = ""
  let open = false
  let wanted: { items: T } | null = null
  const settle = () => {
    if (open || !wanted) return
    const { items } = wanted
    wanted = null
    const said = JSON.stringify(items)
    if (said === last) return
    last = said
    set(items)
  }
  return {
    /** The menu's items now. */
    items(items: T) {
      wanted = { items }
      settle()
    },
    /** The menu opened. */
    opened() {
      open = true
    },
    /** The menu closed. */
    closed() {
      open = false
      settle()
    },
  }
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
