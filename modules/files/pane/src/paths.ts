/**
 * A file's path as `files.file` names it: from the Project's folder when
 * it is inside, else whole. Pure, so plain tests cover it.
 */
import { nameAndFolder } from "@banda/ui/lib/paths"
import { within } from "./where"

/** `path` from `root` when it is inside it, else as it is. */
export function fromRoot(path: string, root: string | null): string {
  return (root && within(root, path)) || path
}

/** The full path of `src`, a picture a markdown file at `file` names:
 * from the file's folder, or whole; none for one that is not a path. */
export function besideFile(file: string, src: string): string | null {
  let path: string
  try {
    path = decodeURIComponent(src.split(/[?#]/)[0])
  } catch {
    return null
  }
  if (!path) return null
  if (path.startsWith("/")) return path
  const steps = (nameAndFolder(file).folder ?? "").split("/").filter(Boolean)
  for (const step of path.split("/")) {
    if (step === "..") steps.pop()
    else if (step && step !== ".") steps.push(step)
  }
  return (file.startsWith("/") ? "/" : "") + steps.join("/")
}
