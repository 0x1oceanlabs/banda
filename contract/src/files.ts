/**
 * The files module's words for TypeScript: one folder's names as
 * `files.list` reads them, what `files.stat` says a path is, a file's text
 * from `files.read`, the paths `files.find` finds, the pieces of
 * `files.watch`, the Person's places, the files opened lately, and its
 * `files.toml` as the look resolves it (ADR 0073, decision 13).
 */
import type { ModuleFile } from "./look"
import type { Finder } from "./generated/files/Finder"

export type { Entry } from "./generated/files/Entry"
export type { FindAsk } from "./generated/files/FindAsk"
export type { Found } from "./generated/files/Found"
export type { Kind } from "./generated/files/Kind"
export type { ListAsk } from "./generated/files/ListAsk"
export type { Listing } from "./generated/files/Listing"
export type { ReadAsk } from "./generated/files/ReadAsk"
export type { Stat } from "./generated/files/Stat"
export type { StatAsk } from "./generated/files/StatAsk"
export type { Text } from "./generated/files/Text"
export type { WatchAsk } from "./generated/files/WatchAsk"
export type { Watched } from "./generated/files/Watched"
export type { Finder } from "./generated/files/Finder"
export type { Opened } from "./generated/files/Opened"
export type { OpenedAsk } from "./generated/files/OpenedAsk"
export type { Places } from "./generated/files/Places"
export type { RecentAsk } from "./generated/files/RecentAsk"

/** What Files shows, as `banda look` gives it with no `files.toml`:
 * nothing pinned, dotfiles hidden, what git ignores greyed, the first
 * editor found. */
export const DEFAULT_FINDER: Finder = {
  pinned: [],
  hidden: false,
  ignored: true,
  editor: "",
}

/** The files module's `files.toml`. */
export const FILES_FILE: ModuleFile<Finder> = {
  name: "files.toml",
  before: DEFAULT_FINDER,
}
