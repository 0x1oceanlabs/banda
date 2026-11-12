/**
 * A sub-agent opened where its Thread's Pane is alone (ADR 0103, decision
 * 21): nothing can be drawn beside the Pane (`PaneProps.alone`), so the
 * sub-agent shows over the Thread, as a screen on top, with a way back;
 * one of its own sub-agents is one more screen, in place of the
 * breadcrumb. The screens are a view of the Thread's Pane, as its scroll
 * is: nothing goes into the arrangement, and none comes back after a
 * restart. The same for every client (ADR 0089, decision 1); the views
 * draw what this says. Pure, so plain tests cover it.
 */
import type { Subagent, SubagentId, ThreadId } from "@banda/contract/agents"
import { type Head, headOf, OPEN_BESIDE } from "./beside"
import { askerOf } from "./subagents"

/** How a Thread's Pane opens one of its sub-agents from its row: beside
 * it, as a Pane in its Group, where the window has room; or over it, as a
 * screen, where the Pane is alone. */
export type Opens = "beside" | "over"

/** How a Thread's Pane opens its sub-agents, `alone` or not, where their
 * Pane opens from it at all (`beside`, as `opensBeside` answers): none
 * where it does not, as on another host's Thread, whose rows opened in
 * place show them. */
export function opensOf(alone: boolean, beside: boolean): Opens | undefined {
  if (!beside) return undefined
  return alone ? "over" : "beside"
}

/** What a row's button that opens its sub-agent reads: "Open beside", or,
 * over its Thread, "Open". */
export function openWords(opens: Opens): string {
  return opens === "over" ? "Open" : "Open beside"
}

/** The screens over a Thread's Pane, from the first one opened, one of
 * the Thread's sub-agents, to the one on top. None: the Thread shows. */
export type Screens = readonly SubagentId[]

/** No screen: the Thread shows. */
export const NO_SCREENS: Screens = []

/** `screens` with `sub` opened on top: from the Thread, the first; from a
 * screen, one of its own sub-agents, one more. The one on top already is
 * not opened twice. */
export function opened(screens: Screens, sub: SubagentId): Screens {
  return screens.at(-1) === sub ? screens : [...screens, sub]
}

/** What a Thread's row asks as it opens its sub-agent: beside, the
 * window's action that opens its Pane in the Thread's Group, with its args,
 * as before there were screens; over, the screens with it on top. */
export type Opening =
  | { action: typeof OPEN_BESIDE; args: { [key: string]: string } }
  | { screens: Screens }

/** What opening sub-agent `sub` of Thread `thread` of `project` asks, as
 * `opens` says, over `screens`; beside, in the Group of the Thread whose
 * Agent is `agent`. */
export function subagentOpening(
  opens: Opens,
  screens: Screens,
  sub: SubagentId,
  {
    project,
    thread,
    agent,
  }: { project: string; thread: ThreadId; agent?: string }
): Opening {
  if (opens === "over") return { screens: opened(screens, sub) }
  const args = { project, thread, sub, ...(agent && { agent }) }
  return { action: OPEN_BESIDE, args }
}

/** `screens` one level up, as ← and `Esc` go: to the screen under the
 * one on top, or from the first back to the Thread; and the row that
 * then takes the focus, the one the screen that went was opened from. */
export function back(screens: Screens): {
  screens: Screens
  row?: SubagentId
} {
  const row = screens.at(-1)
  return row === undefined
    ? { screens }
    : { screens: screens.slice(0, -1), row }
}

/**
 * What a screen's header row says after ←, of `lane` of Thread `thread`,
 * titled `title`, whose sub-agents are `lanes`: its satellite, its label,
 * and, muted, whose sub-agent it is. At the top level, "sub-agent of
 * ‹Thread›", as its Pane beside says; nested, "sub-agent of Reviewer", the
 * one that started it, in place of the breadcrumb: ← goes up to it.
 */
export function screenHeadOf(
  thread: ThreadId,
  lane: Subagent,
  lanes: readonly Subagent[],
  title: string
): Head {
  const { look, label, of } = headOf(thread, lane, lanes, title)
  const parent = askerOf(lane.parent, lanes) ?? "a sub-agent"
  return { look, label, of: of ?? `sub-agent of ${parent}` }
}
