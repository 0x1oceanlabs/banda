/**
 * The sandbox host, `app://preview` (ADR 0073, decision 5): a page of the
 * Person's files that may run scripts of its own, an HTML file or an SVG
 * document, shown in a Pane's frame. Its links are signed as the byte
 * host's are, by a secret of its own.
 *
 * It serves a page only into a frame, never to a page's own fetch nor as
 * a window's page, and its response sandboxes it whatever the frame says:
 * scripts run, on an origin of no one's, with no Banda, no storage and
 * nothing from the network. Only its own styles, and pictures that are
 * inline or that the byte host serves, load.
 */
import { extname } from "node:path"
import { Context, Effect, Layer } from "effect"
import {
  FileLinks,
  type LinkHost,
  linkHost,
  type Rules,
  wholeIn,
} from "./files"

/** The pages it serves, by their extension. */
const PAGES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".xhtml": "application/xhtml+xml; charset=utf-8",
  ".svg": "image/svg+xml",
}

/** What a page may do: its own scripts and styles, inline; pictures
 * inline or from the byte host; nothing else, and always sandboxed, with
 * no origin of its own (no `allow-same-origin`). */
export const PREVIEW_CSP = [
  "default-src 'none'",
  "img-src app://files data:",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "sandbox allow-scripts",
].join("; ")

/**
 * Whether `request` is a frame's own page: a navigation into a frame,
 * never a page's fetch, a picture, or a window's page where Chromium says
 * which. Electron's handler hears no `Sec-Fetch-*`: there a navigation is
 * what asks to be upgraded and names no origin, which a page's fetch
 * cannot ask without a preflight this host refuses.
 */
function intoFrame(request: Request): boolean {
  const { headers } = request
  const dest = headers.get("sec-fetch-dest")
  if (dest !== null) return dest === "iframe" || dest === "frame"
  return (
    headers.get("upgrade-insecure-requests") === "1" && !headers.has("origin")
  )
}

export const PREVIEW_HOST: Rules = {
  host: "preview",
  typeOf: (path) => PAGES[extname(path).toLowerCase()] ?? null,
  admits: intoFrame,
  headers: (type) => ({
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": PREVIEW_CSP,
    "Cache-Control": "no-store",
    // Only a frame takes it: no other origin may load it as a part.
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
  }),
}

/** The sandbox host: main builds its layer and serves `app://preview`
 * with it. */
export class PreviewHost extends Context.Service<PreviewHost, LinkHost>()(
  "banda/PreviewHost"
) {
  static readonly layer = Layer.sync(PreviewHost, () =>
    linkHost(new FileLinks(undefined, PREVIEW_HOST))
  )

  /** A URL for the page at `path` in Project `project`, relative to its
   * folder or whole; none for a file that is not a page. */
  static readonly url = (project: string, path: string) =>
    Effect.gen(function* () {
      const whole = yield* wholeIn(project, path)
      if (!whole) return null
      return yield* PreviewHost.use((host) => host.issue(whole))
    })
}
