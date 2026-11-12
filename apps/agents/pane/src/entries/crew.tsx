/**
 * A Crew's row, where it started (ADR 0103, step 4). The engine keeps the
 * Crew and the Pane folds its facts; its row and its Pane come with the
 * window's part of the step, so until then it draws nothing.
 */
import type { EntryView } from "./types"

export const CrewEntry: EntryView<"crew"> = () => null
