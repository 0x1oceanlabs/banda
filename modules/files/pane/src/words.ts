/**
 * A file in words, for its facts: what kind it is, and how big. Pure, so
 * plain tests cover it.
 */
import type { Stat } from "@banda/contract/files"
import { extensionOf } from "@banda/ui/lib/previewers"

/** What a file is, in a word or two, for its facts. */
export function kindWords(
  stat: Pick<Stat, "path" | "kind"> & { mime?: string | null }
): string {
  if (stat.kind === "folder") return "Folder"
  const [family = ""] = (stat.mime ?? "").split("/")
  const what = ["image", "video", "audio", "font"].includes(family)
    ? family
    : stat.mime === "application/pdf"
      ? "document"
      : "file"
  const extension = extensionOf(stat.path)
  return extension
    ? `${extension.toUpperCase()} ${what}`
    : what[0].toUpperCase() + what.slice(1)
}

/** A size as a Finder writes it: `512 bytes`, `12.3 KB`, `4.1 MB`. */
export function sizeWords(bytes: number): string {
  if (bytes < 1000) return bytes === 1 ? "1 byte" : `${bytes} bytes`
  const units = ["KB", "MB", "GB", "TB"]
  let size = bytes / 1000
  let unit = 0
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000
    unit++
  }
  const shown =
    size < 10 ? size.toFixed(1).replace(/\.0$/, "") : Math.round(size)
  return `${shown} ${units[unit]}`
}

/** A count of things in words: `1 row`, `100,000 rows`. */
export function countWords(count: number, word: string): string {
  return `${count.toLocaleString("en")} ${word}${count === 1 ? "" : "s"}`
}

/** When something last changed, as a clock and a calendar read it. */
export const WHEN = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})
