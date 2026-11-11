/**
 * A file outside Banda (ADR 0073, decisions 10, 12 and 13): in a code
 * editor at its line, in the system's file manager, or in the app the
 * system has for it. The editors are the desktop's to find; which one a
 * file opens in is `files.toml`'s `editor`, else the first found.
 * Each takes a `DeviceFile`: only `device.local` gives one, so a file of
 * another machine's can never open here at the path it has there (ADR
 * 0106, decision 3).
 */
import { useEffect, useState } from "react"
import { FILES_FILE } from "@banda/contract/files"
import type { DeviceFile } from "@banda/core"
import { toast } from "../components/sonner"
import { type Editor, filesHost } from "../desktop"
import { isMac } from "./keys"
import { fileNow, useFile } from "./look"

/** The editors on this machine, and the one a file opens in first. */
export type Editors = {
  /** The one a file opens in: `files.toml`'s, if found, else the first;
   * none when none is found. */
  editor: Editor | null
  /** The rest, in their order. */
  others: Editor[]
}

/** The editors of `found`, the one `named` first when it is there. */
export function editorsOf(found: readonly Editor[], named: string): Editors {
  const editor = found.find((one) => one.id === named) ?? found[0] ?? null
  return { editor, others: found.filter((one) => one !== editor) }
}

let asked: Promise<Editor[]> | undefined

/** The editors found, as the desktop says them once a run; none outside
 * Banda's desktop window. */
export function editorsFound(): Promise<Editor[]> {
  asked ??=
    filesHost()
      ?.editors()
      .catch(() => []) ?? Promise.resolve([])
  return asked
}

const NONE: Editors = { editor: null, others: [] }

/** The editors on this machine, as `files.toml` orders them; none until
 * the desktop has said. */
export function useEditors(): Editors {
  const named = useFile(FILES_FILE).editor
  const [found, setFound] = useState<readonly Editor[]>()
  useEffect(() => {
    let gone = false
    void editorsFound().then((editors) => gone || setFound(editors))
    return () => {
      gone = true
    }
  }, [])
  return found ? editorsOf(found, named) : NONE
}

/** Where a file is: its whole path, and the line and column a link names. */
export type At = { line?: number | null; column?: number | null }

/** What went wrong in main, without Electron's words around it. */
function said(error: unknown): string {
  const words = error instanceof Error ? error.message : String(error)
  return words.replace(/^Error invoking remote method '[^']*': (\w+: )?/, "")
}

/**
 * Opens the file or folder at the whole `path` in `editor`, or the one
 * `files.toml` prefers, at its line; in the app the system has for it
 * when no editor is found. A toast says what went wrong.
 */
export async function openInEditor(
  path: DeviceFile,
  at: At = {},
  editor?: string
): Promise<void> {
  const host = filesHost()
  if (!host) return
  const id =
    editor ??
    editorsOf(await editorsFound(), fileNow(FILES_FILE).editor).editor?.id
  if (!id) return host.outside(path)
  await host
    .openIn(id, path, at.line ?? null, at.column ?? null)
    .catch((error: unknown) => toast.warning(said(error)))
}

/** Shows the file at the whole `path` in its folder, in the system's file
 * manager. */
export function reveal(path: DeviceFile): void {
  filesHost()?.show(path)
}

/** Opens the file at the whole `path` in the app the system has for it;
 * a program it only shows in its folder. */
export function openWithSystem(path: DeviceFile): void {
  filesHost()?.outside(path)
}

/** This computer, as a file held over another machine's Pane names it
 * (ADR 0106, decision 3). */
export const THIS_COMPUTER = isMac ? "this Mac" : "this machine"

/** The system's file manager, as "Reveal in" names it. */
export const FILE_MANAGER = isMac
  ? "Finder"
  : typeof navigator !== "undefined" && /Win/.test(navigator.platform)
    ? "Explorer"
    : "Files"
