/**
 * The terminal module's words for TypeScript: what `terminal.open` starts
 * and what `terminal.watch` says, the servers `terminal.ports` finds, how
 * many terminals `terminal.running` counts, and its `terminal.toml` as the
 * look resolves it (ADR 0047).
 */
import type { ModuleFile } from "./look"
import type { Writing } from "./generated/terminal/Writing"

export type { Drawn } from "./generated/terminal/Drawn"
export type { Ended } from "./generated/terminal/Ended"
export type { Open } from "./generated/terminal/Open"
export type { Piece } from "./generated/terminal/Piece"
export type { Running } from "./generated/terminal/Running"
export type { Size } from "./generated/terminal/Size"
export type { TerminalId } from "./generated/terminal/TerminalId"
export type { Title } from "./generated/terminal/Title"
export type { Server } from "./generated/terminal/Server"
export type { Servers } from "./generated/terminal/Servers"
export type { StartedBy } from "./generated/terminal/StartedBy"
export type { Writing } from "./generated/terminal/Writing"
export type { CursorStyle } from "./generated/terminal/CursorStyle"

/** How the terminal writes, as `banda look` gives it with no
 * `terminal.toml`: the look's font and size, ligatures, a blinking block. */
export const DEFAULT_WRITING: Writing = {
  font: null,
  size: null,
  ligatures: true,
  cursor: "block",
  blink: true,
}

/** The terminal's `terminal.toml`. */
export const TERMINAL_FILE: ModuleFile<Writing> = {
  name: "terminal.toml",
  before: DEFAULT_WRITING,
}
