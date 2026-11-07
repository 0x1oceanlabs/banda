/**
 * What an archive holds, as Files' tree draws it (ADR 0073, decision 6):
 * each name as a path of the tree, a folder's ending in `/`, and each
 * file's size beside it. A name is only text: one that starts at the root
 * or with `./` is drawn from the top, and `..` is a folder's name like
 * any other, never a way up. Pure, so plain tests cover it.
 */
import type { Archive, Packed, Packing } from "@banda/contract/files"
import { foldersOf } from "@banda/ui/lib/tree-paths"
import { countWords, sizeWords } from "./words"

/** An entry's path as the tree draws it; none for one that names
 * nothing, as `/` or `./`. */
export function treePath(
  entry: Pick<Packed, "path" | "folder">
): string | null {
  const names = entry.path
    .replace(/\\/g, "/")
    .split("/")
    .filter((name) => name !== "" && name !== ".")
  if (names.length === 0) return null
  return names.join("/") + (entry.folder ? "/" : "")
}

/** The tree of `entries`: its paths, the files' sizes by path, and each
 * entry by its path. */
export function treeOf(entries: readonly Packed[]): {
  paths: string[]
  notes: Map<string, string>
  entries: Map<string, Packed>
} {
  const paths: string[] = []
  const notes = new Map<string, string>()
  const byPath = new Map<string, Packed>()
  for (const entry of entries) {
    const path = treePath(entry)
    if (path === null || byPath.has(path)) continue
    byPath.set(path, entry)
    paths.push(path)
    if (!entry.folder && entry.size !== undefined)
      notes.set(path, sizeWords(entry.size))
  }
  return { paths, notes, entries: byPath }
}

/** What each kind of archive is called. */
export const PACKINGS: Record<Packing, string> = {
  zip: "Zip",
  tar: "Tar",
  tar_gz: "Gzipped tar",
  gz: "Gzip",
  "7z": "7z",
}

/** An archive in a line: its kind, how many files and folders, and how
 * big they are, unpacked and packed where it says. */
export function summaryOf(archive: Archive, size: number | null): string {
  const files = archive.entries.filter((entry) => !entry.folder)
  // Every folder, named or only in its files' paths.
  const folders = new Set(
    archive.entries.flatMap((entry) => {
      const path = treePath(entry)
      if (path === null) return []
      return entry.folder ? [...foldersOf(path), path] : foldersOf(path)
    })
  ).size
  const unpacked = files.reduce((sum, one) => sum + (one.size ?? 0), 0)
  const packed =
    archive.packing === "zip"
      ? files.reduce((sum, one) => sum + (one.packed ?? 0), 0)
      : size
  return [
    PACKINGS[archive.packing],
    folders > 0
      ? `${countWords(files.length, "file")} in ${countWords(folders, "folder")}`
      : countWords(files.length, "file"),
    `${sizeWords(unpacked)} unpacked${packed === null ? "" : `, ${sizeWords(packed)} packed`}`,
  ].join(" · ")
}
