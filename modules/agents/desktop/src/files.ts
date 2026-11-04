/** Local markdown media, served only through signed, expiring URLs
 * bound to a canonical path and file identity (ADR 0037, decision 8). */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { constants } from "node:fs"
import { open, realpath, stat } from "node:fs/promises"
import { extname, isAbsolute } from "node:path"
import { Readable } from "node:stream"
import { Clock, Context, Effect, Layer } from "effect"

const TYPES: Record<string, string> = {
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
}
const HOUR = 60 * 60 * 1000
const local = (path: string) =>
  isAbsolute(path) && !/^[/\\]{2}/.test(path) && !path.includes("\0")
type Claim = {
  path: string
  dev: string
  ino: string
  until: number
  type: string
}

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
  constructor(secret = randomBytes(32)) {
    this.secret = secret
  }
  private mac(payload: string) {
    return createHmac("sha256", this.secret).update(payload).digest()
  }

  async issue(path: string, now: number): Promise<string | null> {
    if (!local(path)) return null
    const type = TYPES[extname(path).toLowerCase()]
    if (!type) return null
    try {
      const canonical = await realpath(path)
      if (!local(canonical) || TYPES[extname(canonical).toLowerCase()] !== type)
        return null
      const file = await stat(canonical, { bigint: true })
      if (!file.isFile()) return null
      const claim: Claim = {
        path: canonical,
        dev: String(file.dev),
        ino: String(file.ino),
        until: now + HOUR,
        type,
      }
      const payload = Buffer.from(JSON.stringify(claim)).toString("base64url")
      return `app://files/${payload}.${this.mac(payload).toString("base64url")}`
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
    if (url.host !== "files" || !match || url.search) return missing()
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
      !local(claim.path) ||
      !Number.isFinite(claim.until) ||
      now >= claim.until ||
      TYPES[extname(claim.path).toLowerCase()] !== claim.type
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
        const headers = new Headers({
          "Content-Type": claim.type,
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Cache-Control": "no-store",
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
        })
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

export class Files extends Context.Service<
  Files,
  {
    issue: (path: string) => Effect.Effect<string | null>
    serve: (request: Request) => Effect.Effect<Response>
  }
>()("banda/agents/Files") {
  static layer = Layer.sync(Files, () => {
    const links = new FileLinks()
    return {
      issue: (path) =>
        Clock.currentTimeMillis.pipe(
          Effect.flatMap((now) => Effect.promise(() => links.issue(path, now)))
        ),
      serve: (request) =>
        Clock.currentTimeMillis.pipe(
          Effect.flatMap((now) =>
            Effect.promise(() => links.serve(request, now))
          )
        ),
    }
  })
}
