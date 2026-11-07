/**
 * The byte host, `app://files` (ADR 0037, decision 8; ADR 0073, decision
 * 5): a file on this machine, served only through a signed URL that
 * expires, bound to the file's canonical path, device and inode. Any
 * module's part in main may give one out; main serves the host.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { constants } from "node:fs"
import { open, realpath, stat } from "node:fs/promises"
import { extname, resolve } from "node:path"
import { Readable } from "node:stream"
import { Clock, Context, Effect, Layer } from "effect"
import { Engine } from "./engine"
import { onThisMachine } from "./machine"

/** Text of any kind is served as plain text, so nothing in it runs: an
 * HTML file shows as its source. */
const TEXT = "text/plain; charset=utf-8"
const TEXTS = [
  "txt md markdown mdx rst log csv tsv",
  "json jsonc json5 jsonl yaml yml toml ini cfg conf env xml",
  "html htm xhtml css scss sass less",
  "js mjs cjs jsx ts mts cts tsx vue svelte",
  "py rb rs go java kt swift c h cc cpp hpp cs php lua sql",
  "sh bash zsh fish diff patch lock",
]
  .join(" ")
  .split(" ")

/** What a file is served as, by its extension; any other is bytes. */
const TYPES: Record<string, string> = {
  // The images, video and sound a reply shows (ADR 0037, decision 8).
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".ogv": "video/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ...Object.fromEntries(TEXTS.map((ext) => [`.${ext}`, TEXT])),
}
const BYTES = "application/octet-stream"
const MEDIA = /^(image|video|audio)\//

/** What the file at `path` is served as. */
const typeOf = (path: string) => TYPES[extname(path).toLowerCase()] ?? BYTES

/** Who may ask: `"media"` gives a URL only for an image, a video or a
 * sound. */
export type Only = "media"

/**
 * A host of signed links (`app://<host>/<token>`): which files it serves,
 * which requests it answers, and the headers a file goes with. The byte
 * host serves any file to any page that holds a link; the sandbox host
 * (`preview.ts`) serves a page only into a frame, sandboxed.
 */
export type Rules = {
  host: string
  /** What the file at `path` is served as; none for one it does not serve. */
  typeOf: (path: string) => string | null
  /** Whether it answers `request` at all. */
  admits: (request: Request) => boolean
  /** The headers its bytes go with, besides their length and range. */
  headers: (type: string) => Record<string, string>
}

/** The byte host's (ADR 0073, decision 5): any file, to any page that
 * holds its link; a page's scripts never run, and any page may read it,
 * as Banda's page reads a PDF's ranges. */
export const BYTES_HOST: Rules = {
  host: "files",
  typeOf,
  admits: () => true,
  headers: (type) => ({
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "no-store",
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
  }),
}

const HOUR = 60 * 60 * 1000
type Claim = { path: string; dev: string; ino: string; until: number }

/** Inclusive byte bounds; null for an invalid or unsatisfiable range. */
export function byteRange(
  range: string,
  size: number
): [number, number] | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match || size === 0 || (!match[1] && !match[2])) return null
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]))
  const end =
    match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    start < size &&
    end >= start
    ? [start, end]
    : null
}

/** The signer belongs to one runtime, never to a persisted profile. */
export class FileLinks {
  private readonly secret: Buffer
  private readonly rules: Rules
  constructor(secret = randomBytes(32), rules: Rules = BYTES_HOST) {
    this.secret = secret
    this.rules = rules
  }
  private mac(payload: string) {
    return createHmac("sha256", this.secret).update(payload).digest()
  }

  async issue(path: string, now: number, only?: Only): Promise<string | null> {
    if (!onThisMachine(path)) return null
    const type = this.rules.typeOf(path)
    const media = only === "media"
    if (type === null || (media && !MEDIA.test(type))) return null
    try {
      const canonical = await realpath(path)
      // A link may not make a picture of a file of another kind, nor
      // serve one its host does not.
      const real = this.rules.typeOf(canonical)
      if (
        !onThisMachine(canonical) ||
        real === null ||
        (media && real !== type)
      )
        return null
      const file = await stat(canonical, { bigint: true })
      if (!file.isFile()) return null
      const claim: Claim = {
        path: canonical,
        dev: String(file.dev),
        ino: String(file.ino),
        until: now + HOUR,
      }
      const payload = Buffer.from(JSON.stringify(claim)).toString("base64url")
      return `app://${this.rules.host}/${payload}.${this.mac(payload).toString("base64url")}`
    } catch {
      return null
    }
  }

  async serve(request: Request, now: number): Promise<Response> {
    const missing = () => new Response("Not found", { status: 404 })
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, { status: 405 })
    const url = new URL(request.url)
    const match = /^\/([\w-]+)\.([\w-]+)$/.exec(url.pathname)
    if (url.host !== this.rules.host || !match || url.search) return missing()
    if (!this.rules.admits(request)) return missing()
    const [, payload, signature] = match
    const mac = this.mac(payload)
    const sent = Buffer.from(signature, "base64url")
    if (sent.length !== mac.length || !timingSafeEqual(sent, mac))
      return missing()
    let claim: Claim
    try {
      claim = JSON.parse(Buffer.from(payload, "base64url").toString()) as Claim
    } catch {
      return missing()
    }
    if (
      !onThisMachine(claim.path) ||
      !Number.isFinite(claim.until) ||
      now >= claim.until
    )
      return missing()
    try {
      if ((await realpath(claim.path)) !== claim.path) return missing()
      const file = await open(
        claim.path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      )
      try {
        const info = await file.stat({ bigint: true })
        if (
          !info.isFile() ||
          String(info.dev) !== claim.dev ||
          String(info.ino) !== claim.ino ||
          info.size > BigInt(Number.MAX_SAFE_INTEGER)
        ) {
          await file.close()
          return missing()
        }
        const size = Number(info.size)
        const range = request.headers.get("range")
        const bounds = range === null ? undefined : byteRange(range, size)
        const type = this.rules.typeOf(claim.path)
        if (type === null) {
          await file.close()
          return missing()
        }
        const headers = new Headers(this.rules.headers(type))
        if (bounds === null) {
          await file.close()
          headers.set("Content-Range", `bytes */${size}`)
          return new Response(null, { status: 416, headers })
        }
        const [start, end] = bounds ?? [0, size - 1]
        headers.set("Content-Length", String(bounds ? end - start + 1 : size))
        if (bounds)
          headers.set("Content-Range", `bytes ${start}-${end}/${size}`)
        if (request.method === "HEAD" || size === 0) {
          await file.close()
          return new Response(null, { status: bounds ? 206 : 200, headers })
        }
        const stream = file.createReadStream({ start, end, autoClose: true })
        return new Response(
          Readable.toWeb(stream) as ReadableStream<Uint8Array>,
          { status: bounds ? 206 : 200, headers }
        )
      } catch (error) {
        await file.close()
        throw error
      }
    } catch {
      return missing()
    }
  }
}

/** What a host of signed links offers main. */
export type LinkHost = {
  /** A URL for the file at the whole `path`, for an hour; none for one
   * it may not serve. */
  readonly issue: (path: string, only?: Only) => Effect.Effect<string | null>
  /** Answers a request to its host. */
  readonly serve: (request: Request) => Effect.Effect<Response>
}

/** A host of the links `links` signs, on the runtime's clock. */
export function linkHost(links: FileLinks): LinkHost {
  return {
    issue: (path, only) =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((now) =>
          Effect.promise(() => links.issue(path, now, only))
        )
      ),
    serve: (request) =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((now) => Effect.promise(() => links.serve(request, now)))
      ),
  }
}

/** The whole path of `path` in Project `project`: relative to its folder,
 * or whole. None for a Project the engine does not know, or a path from
 * home, on the network or with a scheme, which it refuses before it
 * resolves: a scheme has two letters or more, as one is a Windows drive. */
export const wholeIn = (project: string, path: string) =>
  Effect.gen(function* () {
    if (!path || /^(?:~|[a-z][a-z0-9+.-]+:|[/\\]{2})/i.test(path)) return null
    const folder = yield* Engine.folderOf(project)
    return folder ? resolve(folder, path) : null
  })

/** The byte host: main builds its layer and serves `app://files` with it. */
export class FileHost extends Context.Service<FileHost, LinkHost>()(
  "banda/FileHost"
) {
  static readonly layer = Layer.sync(FileHost, () => linkHost(new FileLinks()))

  /** A URL for the file at `path` in Project `project` (`wholeIn`). */
  static readonly url = (project: string, path: string, only?: Only) =>
    Effect.gen(function* () {
      const whole = yield* wholeIn(project, path)
      if (!whole) return null
      return yield* FileHost.use((host) => host.issue(whole, only))
    })
}
