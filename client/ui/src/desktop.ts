/**
 * The desktop bridge (ADR 0028) as a Pane reaches it, typed (ADR 0073,
 * decision 14). `FILES_BRIDGE` is the part any Pane may use, whichever
 * module it is: the files on the machine. The window's table takes it in
 * under `files` (client/desktop/src/bridge.ts), and main answers it. A module
 * reaches its own part with `hostOf`. Neither is there outside Banda's
 * desktop window: in the browser build and in tests.
 */
import { type HostOf, invoke, send, type Table } from "@banda/contract/bridge"

/** A code editor found on this machine (ADR 0073, decision 14). */
export type Editor = {
  /** As `files.toml` names it: `zed`, `vscode`, `idea`. */
  id: string
  /** As a menu says it: `Zed`, `VS Code`, `IntelliJ IDEA`. */
  name: string
}

export const FILES_BRIDGE = {
  /** Opens the file at the full `path` in the app the system has for
   * it; a program it only shows in its folder, so it never runs. */
  outside: send<[path: string]>(),
  /** Shows the file at the full `path` in its folder, in the system's
   * file manager (ADR 0063, decision 3). */
  show: send<[path: string]>(),
  /** Whether a file, or a folder, is at the full `path`. */
  exists: invoke<[path: string], boolean>(),
  /** The code editors on this machine, in the order "Open in" lists them;
   * looked for once a run. */
  editors: invoke<[], Editor[]>(),
  /** Opens the file or folder at the full `path` in the editor `editor`
   * names, at `line` and `column` when given. Fails, saying why, when it
   * is gone or the editor would not start. */
  openIn: invoke<
    [editor: string, path: string, line: number | null, column: number | null],
    void
  >(),
  /** Drags the files at the full `paths` out of the window, as the files
   * themselves, for another app to take: called as a drag of rows starts,
   * in place of the page's own. */
  drag: send<[paths: readonly string[]]>(),
}

/** The part of the desktop bridge the window's table takes in under
 * `name`, typed by that part's table `T`; none outside Banda's desktop
 * window. */
export function hostOf<T extends Table>(name: string): HostOf<T> | undefined {
  if (typeof window === "undefined") return undefined
  return (window as unknown as { banda?: Record<string, HostOf<T>> }).banda?.[
    name
  ]
}

/** The files on the machine, for a Pane; none outside Banda's desktop
 * window. */
export const filesHost = () => hostOf<typeof FILES_BRIDGE>("files")
