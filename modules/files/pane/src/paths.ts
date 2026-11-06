/**
 * A picture a markdown file names, found beside it. Pure, so plain tests
 * cover it.
 */
import { nameAndFolder } from "@banda/ui/lib/paths"

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
