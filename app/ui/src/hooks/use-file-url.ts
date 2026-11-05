/**
 * A file's URL of `app://files` (ADR 0073, decision 5), kept fresh: the
 * desktop signs one for an hour, so it is asked for again before then.
 */
import { useEffect, useMemo, useState } from "react"
import { filesHost } from "../desktop"

/** How a URL is asked for: the desktop signs a path, or refuses it. */
export type Mint = (path: string) => Promise<string | null>

/** How long after one URL the next is asked for: within its hour. */
const RENEW = 50 * 60 * 1000

/**
 * The URL `mint` gives `path`, asked for again before it expires, so a
 * Pane that stays open never holds a dead one. Undefined while it is
 * asked for; null when it is refused, and with no `mint` or no `path`.
 */
export function useMinted(
  mint: Mint | null,
  path: string | null
): string | null | undefined {
  const [given, setGiven] = useState<{
    mint: Mint
    path: string
    url: string | null
  }>()
  useEffect(() => {
    if (!mint || path === null) return
    let current = true
    const ask = () =>
      mint(path).then(
        (url) => current && setGiven({ mint, path, url }),
        () => current && setGiven({ mint, path, url: null })
      )
    void ask()
    const timer = setInterval(ask, RENEW)
    return () => {
      current = false
      clearInterval(timer)
    }
  }, [mint, path])
  if (!mint || path === null) return null
  return given?.mint === mint && given.path === path ? given.url : undefined
}

/**
 * A URL for the file at `path` that the Person opens in a Pane of
 * Project `project`: any type, the path relative to the Project's folder
 * or whole. Undefined while it is asked for; null when it is refused,
 * and with no desktop, as in the browser build and in tests.
 */
export function useFileUrl(
  project: string,
  path: string | null
): string | null | undefined {
  const mint = useMemo(() => {
    const files = filesHost()
    return files ? (path: string) => files.url(project, path) : null
  }, [project])
  return useMinted(mint, path)
}
