/**
 * How a module draws a kind of file (ADR 0073, decision 6): a previewer,
 * declared in `defineModule({ previewers })`. What a previewer matches,
 * how much it is wanted, what it can do, and its view, loaded only once a
 * file of its kind is shown. The window gathers the modules' previewers;
 * `lib/previewers` picks the one that draws a file.
 */
import type { ComponentType } from "react"
import type { Engine, JsonValue, ProjectId } from "@banda/contract"

/** Bytes a kind of file holds at its start, as `%PDF-`: each character
 * one byte, from byte `at`. */
export type Magic = { at?: number; bytes: string }

/** What files a previewer draws. A file matches by its extension first,
 * then its MIME type, then the bytes it starts with. */
export type Match = {
  /** Extensions, lower case, with no dot: `pdf`. */
  extensions?: readonly string[]
  /** MIME types, or a family of them: `application/pdf`, `video/*`. */
  mimes?: readonly string[]
  magic?: readonly Magic[]
}

/** A file's bytes, from byte `from` to byte `to`, both in; to its end
 * with no `to`. */
export type Bytes = { from: number; to?: number }

/** The file a view draws, as `files.stat` says it is. */
export type PreviewFile = {
  /** Whole. */
  path: string
  /** As the Person reads it: from the Project's folder when it is in it,
   * else whole. */
  shown: string
  name: string
  mime: string | null
  /** In bytes; none when it is not known. */
  size: number | null
  /** When it last changed, in ms since the epoch. */
  modified: number | null
  /**
   * Its bytes on the file host, `app://files` (ADR 0073, decision 5), which
   * answers a range as HTTP does: `<video>` seeks in it, and `read` asks
   * it. Undefined while it is asked for; null when it is refused, or where
   * no desktop serves files.
   */
  url: string | null | undefined
}

/** What a previewer's view is given. As the file changes within one
 * kind, the view is given the new one: it is not drawn anew. */
export type PreviewProps = {
  file: PreviewFile
  /** Its bytes, all or a range of them, from the file host. */
  read: (range?: Bytes) => Promise<Uint8Array>
  /** In its Pane, or in Quick Look's tile over the desk, where the tree
   * keeps the keys. */
  mode: "quick" | "pane"
  /** The line it opens at, centred and lit once; none for the top. */
  line: number | null
  theme: "light" | "dark"
  /** Aborted once the view draws another file, or goes. */
  signal: AbortSignal
  /** The engine, for what rides its API, as a file's text. */
  engine: Engine
  project: ProjectId
  /** Runs an action, as a Pane does; none where nothing runs one. */
  run?: (action: string, args?: { [key: string]: JsonValue }) => void
  /** What the view keeps with its Pane, as markdown its Source shown. */
  kept: { [key: string]: JsonValue }
  keep: (kept: { [key: string]: JsonValue }) => void
}

export type Previewer = {
  /** Unique, its module's id first: `files.pdf`. `files.toml` names it
   * for an extension the Person picked it for. */
  id: string
  /** What "Open with…" calls it: `PDF`. */
  title: string
  match: Match
  /** Among those that match a file equally, the higher is picked. */
  priority: number
  /** Whether it draws in Quick Look's tile, edits, and finds in a file. */
  can: { quick: boolean; edit: boolean; find: boolean }
  /** Its view, imported as it is first needed. */
  load: () => Promise<{ default: ComponentType<PreviewProps> }>
}

/** Declares a previewer. */
export function definePreviewer(previewer: Previewer): Previewer {
  return previewer
}
