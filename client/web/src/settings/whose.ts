/**
 * Whose copy a settings file is, as Settings says it under the file's
 * rows (ADR 0101, decision 3; #1736, point 4): the file's path, then "on
 * every device" for a shared file, "on this device" for the device's, and
 * "on arc" for a machine's, by the name of the machine Settings shows.
 * The class is the schema's (`x-class`); the words are here alone.
 */
import { type Class, fileClass, type Row } from "@banda/contract/settings"
import { THIS_COMPUTER } from "@banda/ui/lib/outside"
import type { Section } from "@banda/ui/settings"
import { classOf } from "./machine-settings"

/** Whose copy it is, in the line's words; a machine's by the `machine`'s
 * name, or as this computer until its engine said its name. */
export function whoseWords(of: Class, machine?: string): string {
  if (of === "shared") return "on every device"
  if (of === "device") return "on this device"
  return `on ${machine || THIS_COMPUTER}`
}

/** What those words mean, for the pointer that rests on them. */
export function whoseAbout(of: Class, machine?: string): string {
  if (of === "shared")
    return "It means the same on every device. Each machine keeps its copy, and Banda does not copy it between them yet."
  if (of === "device")
    return "How this device works. It stays here and is never copied."
  return `What ${machine || THIS_COMPUTER} has. It is read and written there and never copied.`
}

/** The files a section says whose they are, each once, in its order. None
 * for a section that shows every machine itself, where no one copy is the
 * section's. */
export function filesOf(section: Section): string[] {
  if (section.machine === false) return []
  return [...new Set((section.files ?? []).map((file) => file.name))]
}

/**
 * Where a group of one file's rows says whose it is, when not as its file
 * does: at its heading, where every row is of one class and it has a
 * heading; else at each row that differs.
 */
export function marksOf(group: { title: string; rows: Row[] }): {
  heading?: Class
  rows: Map<string, Class>
} {
  const differ = group.rows.flatMap((row) => {
    const of = classOf(row.file, row.key)
    return of === fileClass(row.file) ? [] : [[row.key, of] as const]
  })
  const first = differ[0]?.[1]
  const whole =
    group.title !== "" &&
    differ.length === group.rows.length &&
    differ.every(([, of]) => of === first)
  return whole ? { heading: first, rows: new Map() } : { rows: new Map(differ) }
}

/** A path with home as `~`, as a Person writes it: of this device or of
 * another machine, whose home the page is not told. */
export function tilde(path: string): string {
  return path.replace(
    /^(?:\/home\/[^/]+|\/Users\/[^/]+|\/root|[A-Za-z]:\\Users\\[^\\]+)(?=[/\\]|$)/,
    "~"
  )
}

/** `file` in `folder`, joined as the folder's own path is. */
export function inFolder(folder: string, file: string): string {
  return `${folder}${folder.includes("\\") ? "\\" : "/"}${file}`
}

/** A path as its folders and its name with the stroke before it, so a
 * long one is cut in its folders and still says its name. */
export function partsOf(path: string): { folders: string; name: string } {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"), 0)
  return { folders: path.slice(0, cut), name: path.slice(cut) }
}
