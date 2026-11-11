/**
 * Files as they cross a boundary (ADR 0106, law 2): inside a Pane a path
 * is a string, and what leaves one names its owner. A ProjectFile says
 * which Project it is in, stamped by the session that binds the Pane to
 * that Project, so no answer of a host's, and no path alone, ever says
 * whose a file is. A DeviceFile is one this computer holds: only
 * `device.local` gives one, so what opens a file in this computer's apps
 * takes no other machine's path.
 */
import type { ProjectId } from "@banda/contract"

declare const projectFile_: unique symbol
declare const deviceFile_: unique symbol

/** A file of a Project, by the session of the Pane that holds it. */
export type ProjectFile = {
  readonly project: ProjectId
  readonly path: string
  readonly [projectFile_]: true
}

/** A machine's own file, outside any Project, by that machine's Host
 * scope's ID. */
export type MachineFile = { readonly machine: ProjectId; readonly path: string }

/** A path on this computer's disk, from `Device.local`. */
export type DeviceFile = string & { readonly [deviceFile_]: true }

/**
 * Stamps `path` as a file of `project`. Only what holds a Pane's session
 * does: the Pane's handles (`file`), the window's file acts, and a drop's
 * or a paste's payload as it is parsed. A Project named in a host's
 * answer is never stamped.
 */
export function projectFile(project: ProjectId, path: string): ProjectFile {
  return { project, path } as ProjectFile
}

/** `path` as one of this computer's files, as `Device.local` found it. */
export function deviceFile(path: string): DeviceFile {
  return path as DeviceFile
}

/** Project files as a drag or Files' clipboard carries them, parsed: each
 * must name a Project and a whole path, so what comes back is never
 * trusted for being Banda's own type. None for anything else. */
export function readProjectFiles(value: unknown): ProjectFile[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const files: ProjectFile[] = []
  for (const one of value) {
    if (typeof one !== "object" || one === null) return null
    const { project, path } = one as Record<string, unknown>
    if (typeof project !== "string" || project === "") return null
    if (typeof path !== "string" || !path.startsWith("/")) return null
    files.push(projectFile(project as ProjectId, path))
  }
  return files
}
