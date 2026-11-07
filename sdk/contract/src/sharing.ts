/**
 * The sharing module's words for TypeScript (ADR 0039, decision 4): what
 * the Person shares, the ID it goes with, and each event as it went.
 */
import type { Shares } from "./generated/sharing/Shares"
import type { ModuleFile } from "./look"

export type { Examples } from "./generated/sharing/Examples"
export type { Never } from "./generated/sharing/Never"
export type { Sent } from "./generated/sharing/Sent"
export type { Shared } from "./generated/sharing/Shared"
export type { Shares } from "./generated/sharing/Shares"

/** `sharing.toml`, as the look resolves it: nothing shared till it comes. */
export const SHARING_FILE: ModuleFile<Shares> = {
  name: "sharing.toml",
  before: { problems: false, usage: false },
}
