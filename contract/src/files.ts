/**
 * The files module's words for TypeScript: one folder's names as
 * `files.list` reads them, what `files.stat` says a path is, a file's text
 * from `files.read` and what `files.write` answers, the paths `files.find`
 * finds, the pieces of `files.watch`, the Person's places, the files
 * opened lately, what an archive holds and a workbook's sheet, for the
 * previewers; what an operation did and what undoes it, the pieces of a
 * move or a copy, the system's Trash, and the lines `files.search`
 * finds; a file's small picture, what a path is at length and what a
 * folder holds, counted; and its `files.toml` as the look resolves it (ADR 0073,
 * decision 13).
 */
import type { ModuleFile } from "./look"
import type { Finder } from "./generated/files/Finder"

export type { Archive } from "./generated/files/Archive"
export type { ArchiveAsk } from "./generated/files/ArchiveAsk"
export type { Entry } from "./generated/files/Entry"
export type { FindAsk } from "./generated/files/FindAsk"
export type { Found } from "./generated/files/Found"
export type { Kind } from "./generated/files/Kind"
export type { ListAsk } from "./generated/files/ListAsk"
export type { Locked } from "./generated/files/Locked"
export type { Listing } from "./generated/files/Listing"
export type { ReadAsk } from "./generated/files/ReadAsk"
export type { Stat } from "./generated/files/Stat"
export type { StatAsk } from "./generated/files/StatAsk"
export type { Text } from "./generated/files/Text"
export type { WatchAsk } from "./generated/files/WatchAsk"
export type { Watched } from "./generated/files/Watched"
export type { WriteAsk } from "./generated/files/WriteAsk"
export type { Written } from "./generated/files/Written"
export type { Finder } from "./generated/files/Finder"
export type { Opened } from "./generated/files/Opened"
export type { OpenedAsk } from "./generated/files/OpenedAsk"
export type { Places } from "./generated/files/Places"
export type { RecentAsk } from "./generated/files/RecentAsk"
export type { Packed } from "./generated/files/Packed"
export type { Packing } from "./generated/files/Packing"
export type { Sheet } from "./generated/files/Sheet"
export type { SheetAsk } from "./generated/files/SheetAsk"
export type { Clash } from "./generated/files/Clash"
export type { Commit } from "./generated/files/Commit"
export type { Counted } from "./generated/files/Counted"
export type { Exif } from "./generated/files/Exif"
export type { Info } from "./generated/files/Info"
export type { InfoAsk } from "./generated/files/InfoAsk"
export type { Picture } from "./generated/files/Picture"
export type { SizeAsk } from "./generated/files/SizeAsk"
export type { Thumb } from "./generated/files/Thumb"
export type { ThumbAsk } from "./generated/files/ThumbAsk"
export type { Clashing } from "./generated/files/Clashing"
export type { Done } from "./generated/files/Done"
export type { Job } from "./generated/files/Job"
export type { Making } from "./generated/files/Making"
export type { Matched } from "./generated/files/Matched"
export type { MoveAsk } from "./generated/files/MoveAsk"
export type { SearchAsk } from "./generated/files/SearchAsk"
export type { Searched } from "./generated/files/Searched"
export type { Step } from "./generated/files/Step"
export type { Trashcan } from "./generated/files/Trashcan"
export type { Trashed } from "./generated/files/Trashed"

/** What Files shows, as `banda look` gives it with no `files.toml`:
 * nothing pinned, dotfiles hidden, what git ignores greyed, the first
 * editor found, each file in the previewer that matches it best, and
 * icons, not small pictures, in the tree. */
export const DEFAULT_FINDER: Finder = {
  pinned: [],
  hidden: false,
  ignored: true,
  editor: "",
  previewers: {},
  thumbnails: false,
}

/** The files module's `files.toml`. */
export const FILES_FILE: ModuleFile<Finder> = {
  name: "files.toml",
  before: DEFAULT_FINDER,
}
