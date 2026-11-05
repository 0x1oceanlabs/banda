/**
 * Paths in a reply (ADR 0063, decision 2): which words name a file, and
 * the line they point at. Pure: whether the file is there is the
 * window's to say, so a word that only looks like a path costs a look and
 * nothing more. Files' link claims take this over (ADR 0034, step 5).
 */

/** A path as a reply names it, with the line and column it points at. */
export type Named = { path: string; line?: number; column?: number }

const AT = /:(\d+)(?::(\d+))?$/
const HASH = /#L(\d+)(?:C(\d+))?$/i

/** `text` apart from its line: `:12`, `:12:3`, `#L12` or `#L12C3`. */
export function named(text: string): Named {
  const match = AT.exec(text) ?? HASH.exec(text)
  if (!match) return { path: text }
  const named: Named = { path: text.slice(0, match.index) }
  const line = Number(match[1])
  const column = Number(match[2])
  if (line > 0) named.line = line
  if (line > 0 && column > 0) named.column = column
  return named
}

/** The line after a path, as a compiler writes it: `:12:3`; none
 * without. */
export function lineText({ line, column }: Omit<Named, "path">): string {
  if (!line) return ""
  return column ? `:${line}:${column}` : `:${line}`
}

/** A scheme, as `https:` or `mailto:`: a link, not a path. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** A filesystem path, rather than a URI or a network address. */
export const localPath = (src: string) =>
  !!src && !SCHEME.test(src) && !src.startsWith("//")

/** The `file://` URL of the file at the full `path`. */
export function fileUrl(path: string): string {
  return `file://${path.split("/").map(encodeURIComponent).join("/")}`
}
/** A start that makes a path a path: the root, home, or `./` or `../`. */
const ROOTED = /^(?:\/|~\/|\.{1,2}\/)/
/** A version, as `1.2.3` or `v2.0`, ends a name that is not a file's. */
const VERSION = /\d\.\d[^.]*$/
const EXTENSION = /\.[\p{L}\p{N}_-]+$/u
/** The endings a host has more often than a folder does. */
const HOSTS = new Set([
  "com",
  "net",
  "org",
  "io",
  "dev",
  "app",
  "ai",
  "co",
  "so",
  "sh",
  "me",
  "edu",
  "gov",
  "info",
  "xyz",
  "cloud",
])

/** Whether a path's first step names a host, as `example.com` or
 * `localhost`, rather than a folder. */
function host(step: string): boolean {
  if (step === "localhost" || /^\d+(?:\.\d+)+$/.test(step)) return true
  const labels = step.toLowerCase().split(".")
  return labels.length > 1 && HOSTS.has(labels.at(-1)!)
}

/** Whether `at`, not rooted, has a file's shape: no host first, no
 * version last, and an extension unless a line is given. */
function fileShaped(at: Named): boolean {
  const { path } = at
  if (!path || path.endsWith("/") || SCHEME.test(path)) return false
  if (host(path.split("/")[0])) return false
  const name = path.split("/").at(-1)!
  if (VERSION.test(name)) return false
  return at.line !== undefined || EXTENSION.test(name)
}

/**
 * Inline code that reads as a path, by T3 Code's rule: no spaces, a `/`
 * or a line, and not a host, a port or a version. Without a root, its
 * name needs a file's extension unless a line is given.
 */
export function codePath(code: string): Named | null {
  const text = code.trim()
  if (!text || /[\s`]/.test(text)) return null
  const at = named(text)
  if (at.line === undefined && !text.includes("/")) return null
  if (ROOTED.test(at.path)) return at
  return fileShaped(at) ? at : null
}

/**
 * A Markdown link's destination that names a file: a path from the root,
 * from home, or from the Thread's folder. A `file://` URL is one already
 * ({@link fileUrls}). None for a page, a place in the reply, or any other
 * scheme; a heading after the file is left off, and `#L12` is its line.
 */
export function linkPath(href: string): Named | null {
  if (!localPath(href) || href.startsWith("#")) return null
  const mark = href.indexOf("#")
  const hash = mark < 0 ? "" : href.slice(mark + 1)
  const path = (mark < 0 ? href : href.slice(0, mark)).split("?")[0]
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return null
  }
  if (!decoded || decoded.includes("\0")) return null
  return named(HASH.test(`#${hash}`) ? `${decoded}#${hash}` : decoded)
}

/** A path in plain text: a `/` in it, and a file's extension at its end,
 * then perhaps its line. Not inside a word, a URL or another path. */
const IN_TEXT =
  /(?<![\p{L}\p{N}_/.~@:-])(?:(?:~|\.{1,2})?\/(?:[\p{L}\p{N}_.@+-]+\/)*|(?:[\p{L}\p{N}_.@+-]+\/)+)[\p{L}\p{N}_.@+-]*\.[\p{L}\p{N}]+(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)?(?![\p{L}\p{N}_/])/gu

/** The paths in a run of plain text, by where they are in it. */
export function textPaths(
  text: string
): Array<{ start: number; text: string; named: Named }> {
  const found = []
  for (const match of text.matchAll(IN_TEXT)) {
    const at = named(match[0])
    if (ROOTED.test(at.path) || fileShaped(at))
      found.push({ start: match.index, text: match[0], named: at })
  }
  return found
}

/** A `file://` URL's path and line, as `/home/a.ts#L3`; none for any
 * other URL, or a file on another machine. */
export function filePath(url: string): string | null {
  if (!/^file:/i.test(url)) return null
  try {
    const parsed = new URL(url)
    if (parsed.hostname && parsed.hostname !== "localhost") return null
    const path = decodeURIComponent(parsed.pathname)
    return path ? `${path}${parsed.hash}` : null
  } catch {
    return null
  }
}
