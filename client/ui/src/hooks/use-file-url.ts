/**
 * A file's URL (ADR 0073, decision 5; ADR 0106, decision 6), kept fresh.
 * The engine of the Pane's session gives a token for a file
 * (`bytes.issue`), which serves it for an hour, or until that engine
 * restarts; the desktop relays the URL that names it to that engine. So
 * a Pane keeps its file's path, never the URL, and asks again before the
 * hour ends, and once its engine restarted.
 */
import { useEffect, useMemo, useState } from "react"
import type { Engine, Params, ProjectId } from "@banda/contract"

/** How a URL is asked for: the engine gives a token for a path, or
 * refuses it. */
export type Mint = (path: string) => Promise<string | null>

/** What a token is for: any file's bytes, a picture's, a video's or a
 * sound's alone, or a page for a frame (`bytes.issue`). */
export type Use = Params<"bytes.issue">["use"]

/** How long after one URL the next is asked for: within its hour. */
const RENEW = 50 * 60 * 1000

/** The sessions whose tokens the desktop relays (`relayBytesFrom`). */
const relayed = new WeakSet<Engine>()

/**
 * The desktop relays the tokens of `engine`, this window's own engine
 * (ADR 0106, step 4b): a URL is made for its session alone. Another
 * machine's gives none until the desktop relays to that machine too (step
 * 4c), so no token of its goes to this machine's engine.
 */
export function relayBytesFrom(engine: Engine): void {
  relayed.add(engine)
}

/**
 * The URL that names the token `token` for `use`: `app://preview/<token>`
 * for a page, `app://files/<token>` for the rest. It is the one place a
 * URL is made, so a client with no desktop differs only here.
 */
export function bytesUrl(token: string, use: Use): string {
  return `app://${use === "page" ? "preview" : "files"}/${token}`
}

/**
 * How a Pane on `engine`, its session, asks for a URL of a file in
 * Project `project`, for `use`: the path relative to the Project's folder
 * or whole, as the Person reads it; null when the engine refuses it. None
 * for a session the desktop does not relay (`relayBytesFrom`): with no
 * desktop, as in the browser build and in tests, and another machine's.
 */
export function fileMint(
  engine: Engine,
  project: ProjectId,
  use: Use = "file"
): Mint | null {
  if (!relayed.has(engine)) return null
  return (path) =>
    engine.call("bytes.issue", { path, use }, { project }).then(
      ({ token }) => bytesUrl(token, use),
      () => null
    )
}

/**
 * Hears each restart of `engine` after the first boot it says: a new boot
 * ends every token the last one gave. Returns how to stop.
 */
export function onRestart(engine: Engine, heard: () => void): () => void {
  let boot: string | undefined
  return engine.watch((status) => {
    if (status.state !== "open") return
    if (boot !== undefined && boot !== status.boot) heard()
    boot = status.boot
  })
}

/** `fileMint`'s, made again as `engine` restarts, so what asked with it
 * asks again. */
export function useFileMint(
  engine: Engine,
  project: ProjectId,
  use: Use = "file"
): Mint | null {
  const [restarts, setRestarts] = useState(0)
  useEffect(
    () => onRestart(engine, () => setRestarts((was) => was + 1)),
    [engine]
  )
  return useMemo(
    () => fileMint(engine, project, use),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- made again on purpose
    [engine, project, use, restarts]
  )
}

/**
 * The URL `mint` gives `path`, asked for again before it expires, so a
 * Pane that stays open never holds a dead one, and as `version` changes,
 * as when the file changed on disk: the URL it had stays till then.
 * Undefined while it is first asked for; null when it is refused, and
 * with no `mint` or no `path`.
 */
export function useMinted(
  mint: Mint | null,
  path: string | null,
  version?: number
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
  }, [mint, path, version])
  if (!mint || path === null) return null
  return given?.mint === mint && given.path === path ? given.url : undefined
}

/**
 * A URL for the file at `path` in Project `project` that the Person
 * opens in a Pane on `engine`, its session (`useFileMint`), for `use`,
 * asked for again as `version` changes and as the engine restarts.
 * Undefined while it is first asked for; null when it is refused, and
 * where no URL is made.
 */
export function useFileUrl(
  engine: Engine,
  project: ProjectId,
  path: string | null,
  version?: number,
  use: Use = "file"
): string | null | undefined {
  return useMinted(useFileMint(engine, project, use), path, version)
}
