/**
 * The desktop bridge (ADR 0028) as a Pane reaches it, typed (ADR 0073,
 * decision 14). `FILES_BRIDGE` is the part any Pane may use, whichever
 * module it is: the files on the machine. The window's table takes it in
 * under `files` (app/web/src/host.ts), and main answers it. A module
 * reaches its own part with `hostOf`. Neither is there outside Banda's
 * desktop window: in the browser build and in tests.
 */
import { type HostOf, invoke, send, type Table } from "@banda/contract/bridge"

export const FILES_BRIDGE = {
  /** A URL of `app://files` for the file at `path`, relative to Project
   * `project`'s folder or whole, of any type; it lasts an hour. None for
   * a file it cannot serve. `useFileUrl` keeps one fresh. */
  url: invoke<[project: string, path: string], string | null>(),
  /** Opens the file at the full `path` in the app the system has for
   * it; a program it only shows in its folder, so it never runs. */
  outside: send<[path: string]>(),
  /** Shows the file at the full `path` in its folder, in the system's
   * file manager (ADR 0063, decision 3). */
  show: send<[path: string]>(),
  /** Whether a file, or a folder, is at the full `path`. */
  exists: invoke<[path: string], boolean>(),
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
