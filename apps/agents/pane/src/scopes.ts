/** The composer's scope (ADR 0071, decision 1): its keys work while the
 * focus is in the field where a message is written. */
export const COMPOSER = "composer"

/** A Thread's scope: its Pane, its zoom, its details and its find. */
export const THREAD = "thread"

/** A sub-agent's Pane: Esc there goes up to the sub-agent that started
 * the one it shows (ADR 0103, decision 21). */
export const SUBAGENT = "subagent"

/** A Visual's preview over the window, and its zoom. */
export const VISUAL = "visual"
