/**
 * Where a reply's paths lead (ADR 0063, decision 2): each to the file it
 * names, if there is one. A path from the root or home is that file. A
 * relative one starts at the Thread's folder, and then at the root of the
 * repository each file its tools named is in: a worktree beside the Project
 * then works too (#492). Only a file is found, never a folder.
 */
import { stat } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type { FoundFile as Found } from "@banda/contract/agents"

/** At most this many paths are looked at in one call. */
const PATHS = 200
/** At most this many folders a relative path is tried in, after the
 * Thread's own. */
const FOLDERS = 16

/**
 * The file each of `paths` names, or none, in their order. `folder` is
 * the Thread's, `worked` the full paths its tools named, latest first,
 * and `home` the Person's home.
 */
export async function findFiles(
  folder: string | null,
  paths: readonly string[],
  worked: readonly string[],
  home: string
): Promise<Array<Found | null>> {
  const bases = await basesOf(worked, home, folder)
  return Promise.all(
    paths.map((path, n) =>
      n < PATHS ? findOne(path, folder, bases, home) : null
    )
  )
}

async function findOne(
  path: string,
  folder: string | null,
  bases: readonly string[],
  home: string
): Promise<Found | null> {
  if (!path || path.includes("\0")) return null
  if (path === "~" || path.startsWith("~/"))
    return fileIn(null, join(home, path.slice(2)), folder)
  if (isAbsolute(path)) return fileIn(null, resolve(path), folder)
  for (const base of folder ? [folder, ...bases] : bases) {
    const found = await fileIn(base, resolve(base, path), folder)
    if (found) return found
  }
  return null
}

/** The file at the full `file`, if it is one, found from `base`: its
 * relative path is from the Thread's folder if it is in it, else from
 * `base`, or none. */
async function fileIn(
  base: string | null,
  file: string,
  folder: string | null
): Promise<Found | null> {
  const found = await stat(file).catch(() => null)
  if (!found?.isFile()) return null
  const inside = folder !== null && within(file, folder)
  const from = inside ? folder : base
  return { file, relative: from === null ? file : relative(from, file), inside }
}

/** Whether `file` is inside `folder`. */
function within(file: string, folder: string): boolean {
  return file.startsWith(folder.endsWith(sep) ? folder : folder + sep)
}

/**
 * The folders a relative path is tried in after the Thread's: for each
 * file the tools named, latest first, the root of the repository it is
 * in, as a worktree's; its own folder when it is in none. None at or
 * above home, or right under the root, where any name might be.
 */
export async function basesOf(
  worked: readonly string[],
  home: string,
  folder: string | null
): Promise<string[]> {
  const roots = await Promise.all(
    worked
      .filter(isAbsolute)
      .map((file) => rootOf(dirname(resolve(file)), home))
  )
  const bases = roots.filter((root) => root !== null && root !== folder)
  return [...new Set(bases as string[])].slice(0, FOLDERS)
}

/** The nearest folder from `at` up with a `.git` in it; `at` when there
 * is none. */
async function rootOf(at: string, home: string): Promise<string | null> {
  for (let up = at; !beyond(up, home); up = dirname(up))
    if (await stat(join(up, ".git")).catch(() => null)) return up
  return beyond(at, home) ? null : at
}

/** Whether `at` is home or above it, or the root or right under it. */
function beyond(at: string, home: string): boolean {
  const top = dirname(at) === at || dirname(dirname(at)) === dirname(at)
  return top || at === home || within(home, at)
}
