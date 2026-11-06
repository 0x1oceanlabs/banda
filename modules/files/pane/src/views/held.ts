/**
 * The URL a player or a frame shows a file from: the first one given for
 * each version of the file, so the URL renewed within the hour does not
 * start it again.
 */
import { useState } from "react"
import type { PreviewFile } from "@banda/ui/module"

/** What `url` gave first for this version of `file`: undefined while it
 * is asked for, null when it is refused or it broke. */
export function useHeldUrl(
  url: string | null | undefined,
  file: Pick<PreviewFile, "path" | "modified">
): { url: string | null | undefined; broke: () => void } {
  const version = `${file.path}\0${file.modified}`
  const [held, setHeld] = useState<{ version: string; url: string }>()
  const [broken, setBroken] = useState<string | null>(null)
  if (url && held?.version !== version) setHeld({ version, url })
  const shown =
    url === null ? null : held?.version === version ? held.url : undefined
  return {
    url: shown && shown === broken ? null : shown,
    broke: () => setBroken(shown ?? null),
  }
}
