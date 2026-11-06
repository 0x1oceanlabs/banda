/**
 * Where a Files Pane is, as its path bar and its header say it: a folder's
 * whole path, `~` for the home folder, its crumbs, and the path typed in
 * the bar with its Tab completion. Pure, so plain tests cover it.
 */
import type { Entry } from "@banda/contract/files"
import { isFolder } from "./tree"

/** `path` with `~` for `home` and what is under it. */
export function tilded(path: string, home: string | null): string {
  if (!home) return path
  if (path === home) return "~"
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/** The whole path of `typed`: `~` is `home`; one that is not whole is
 * from `from`. Repeated and trailing slashes go. */
export function untilded(
  typed: string,
  home: string | null,
  from: string
): string {
  let path = typed.trim()
  if (home && (path === "~" || path.startsWith("~/")))
    path = home + path.slice(1)
  if (!path.startsWith("/")) path = `${from.replace(/\/$/, "")}/${path}`
  const names = path.split("/").filter((name) => name && name !== ".")
  const kept: string[] = []
  for (const name of names) {
    if (name === "..") kept.pop()
    else kept.push(name)
  }
  return `/${kept.join("/")}`
}

/** `child` from `folder`, the tree's way: `""` for the folder itself. */
export function within(folder: string, child: string): string | null {
  if (child === folder) return ""
  const base = folder.endsWith("/") ? folder : `${folder}/`
  return child.startsWith(base) ? child.slice(base.length) : null
}

/** The whole path of `path`, the tree's, under `folder`. */
export function wholeOf(folder: string, path: string): string {
  const trimmed = path.replace(/\/$/, "")
  if (!trimmed) return folder
  return folder === "/" ? `/${trimmed}` : `${folder}/${trimmed}`
}

/** The folder above `path`; none above the root. */
export function parentOf(path: string): string | null {
  if (path === "/") return null
  const slash = path.lastIndexOf("/")
  return slash <= 0 ? "/" : path.slice(0, slash)
}

/** A folder's name, as a header says it: `/` for the root. */
export function nameOf(path: string): string {
  return path === "/" ? "/" : path.slice(path.lastIndexOf("/") + 1)
}

/** One step of the path bar: a folder's name, and where it goes. */
export type Crumb = { name: string; path: string }

/** The folders of `dir` from the top, as the bar's crumbs: `~` first for
 * the home folder and what is under it, else `/`. */
export function crumbsOf(dir: string, home: string | null): Crumb[] {
  const tilde = home !== null && tilded(dir, home).startsWith("~")
  const top = tilde ? home : "/"
  const crumbs: Crumb[] = [{ name: tilde ? "~" : "/", path: top }]
  const rest = dir.slice(top.length).split("/").filter(Boolean)
  let at = top
  for (const name of rest) {
    at = at === "/" ? `/${name}` : `${at}/${name}`
    crumbs.push({ name, path: at })
  }
  return crumbs
}

/** About how wide a crumb is drawn, in px: its name in the bar's small
 * text, its padding and the chevron before it. */
export function crumbWidth(crumb: Crumb): number {
  return crumb.name === "~" ? 30 : Math.ceil(crumb.name.length * 6.6) + 26
}

/** About how wide the `…` of folded crumbs is, in px. */
const FOLD = 34

/**
 * The crumbs that fit in `room` px: all of them, or the first, a `…` for
 * those folded, and as many of the last as fit, at least the last one.
 */
export function foldCrumbs(
  crumbs: readonly Crumb[],
  room: number
): { shown: (Crumb | "folded")[]; folded: Crumb[] } {
  const all = crumbs.reduce((sum, crumb) => sum + crumbWidth(crumb), 0)
  if (all <= room || crumbs.length <= 2)
    return { shown: [...crumbs], folded: [] }
  let used = crumbWidth(crumbs[0]) + FOLD
  let kept = 0
  for (let n = crumbs.length - 1; n > 1; n--) {
    used += crumbWidth(crumbs[n])
    if (kept > 0 && used > room) break
    kept += 1
  }
  const last = crumbs.length - kept
  return {
    shown: [crumbs[0], "folded", ...crumbs.slice(last)],
    folded: crumbs.slice(1, last),
  }
}

/** A path typed as it is split for Tab: the folder it is in, as typed,
 * and the start of its last name. */
export function typedParts(typed: string): { folder: string; start: string } {
  const slash = typed.lastIndexOf("/")
  return { folder: typed.slice(0, slash + 1), start: typed.slice(slash + 1) }
}

/** The folders of `entries` whose names begin with `start`, in any case:
 * a dotfile's only when `start` begins with a dot. */
export function candidates(entries: readonly Entry[], start: string): string[] {
  const low = start.toLowerCase()
  return entries
    .filter(isFolder)
    .map((entry) => entry.name)
    .filter(
      (name) =>
        name.toLowerCase().startsWith(low) &&
        (start.startsWith(".") || !name.startsWith("."))
    )
}

/** What Tab makes of `typed` with the folders that fit: the one, whole,
 * and a slash after it; of several, as much as they share. */
export function completed(typed: string, names: readonly string[]): string {
  if (names.length === 0) return typed
  const { folder } = typedParts(typed)
  if (names.length === 1) return `${folder}${names[0]}/`
  let shared = names[0]
  for (const name of names.slice(1)) {
    let n = 0
    while (
      n < shared.length &&
      n < name.length &&
      shared[n].toLowerCase() === name[n].toLowerCase()
    )
      n += 1
    shared = shared.slice(0, n)
  }
  const { start } = typedParts(typed)
  return shared.length > start.length ? `${folder}${shared}` : typed
}
