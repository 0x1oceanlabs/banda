import { localMedia } from "../lib/markdown-media"
import { createContext, useContext, useEffect, useState } from "react"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog"

/** The desktop signs local paths; markdown never reads the filesystem. */
export type MediaResolver = (path: string) => Promise<string | null>
const Resolver = createContext<MediaResolver | null>(null)
export function MarkdownMedia({
  resolve,
  children,
}: {
  resolve: MediaResolver
  children: React.ReactNode
}) {
  return <Resolver value={resolve}>{children}</Resolver>
}

function kindOf(src: string) {
  const ext = src.split(".").at(-1)?.toLowerCase()
  if (
    ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"].includes(
      ext ?? ""
    )
  )
    return "image"
  if (["mp4", "webm", "mov", "m4v", "ogv"].includes(ext ?? "")) return "video"
  if (["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(ext ?? ""))
    return "audio"
  return null
}

/** An embedded local file. A refusal stays readable as a file link;
 * playback is always the Person's, never automatic. */
export function MarkdownImage({
  src,
  alt = "",
}: {
  src?: string | Blob
  alt?: string
}) {
  const resolve = useContext(Resolver)
  const path = typeof src === "string" ? src : ""
  const kind = kindOf(path)
  const [loaded, setLoaded] = useState<{ path: string; url: string | null }>()
  const [failed, setFailed] = useState(false)
  const local = localMedia(path)
  useEffect(() => {
    if (!resolve || !local || !kind) return
    let current = true
    const load = () => {
      void resolve(path).then(
        (url) => {
          if (current) {
            setLoaded({ path, url })
            setFailed(false)
          }
        },
        () => {
          if (current) setLoaded({ path, url: null })
        }
      )
    }
    load()
    // Renew while mounted; a persisted reply never keeps an expired URL.
    const timer = setInterval(load, 50 * 60 * 1000)
    return () => {
      current = false
      clearInterval(timer)
    }
  }, [path, resolve, local, kind])
  if (!local) return <img src={path} alt={alt} />
  const name = alt || path.split("/").at(-1) || path
  const url = loaded?.path === path ? loaded.url : undefined
  if (!kind || !resolve || url === null || failed)
    return (
      <a
        href={path}
        title={path}
        className="my-2 block w-fit text-primary underline"
      >
        {name}
        {kind && resolve ? " (unavailable)" : ""}
      </a>
    )
  if (!url)
    return (
      <span role="status" className="text-muted-foreground">
        Loading {name}…
      </span>
    )
  if (kind === "video")
    return (
      <video
        src={url}
        aria-label={name}
        controls
        preload="metadata"
        onError={() => setFailed(true)}
        className="my-2 max-h-96 max-w-full rounded-md"
      />
    )
  if (kind === "audio")
    return (
      <span className="my-2 flex max-w-full flex-col gap-1">
        <span className="text-xs text-muted-foreground">{name}</span>
        <audio
          src={url}
          aria-label={name}
          controls
          preload="metadata"
          onError={() => setFailed(true)}
          className="max-w-full"
        />
      </span>
    )
  return (
    <Dialog>
      <DialogTrigger
        aria-label={`Open ${name}`}
        className="my-2 block max-w-full cursor-zoom-in rounded-md focus-visible:ring-2 focus-visible:ring-ring"
      >
        <img
          src={url}
          alt={alt}
          onError={() => setFailed(true)}
          className="max-h-96 max-w-full rounded-md object-contain"
        />
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100%-2rem)] w-auto sm:max-w-[calc(100%-4rem)]">
        <DialogTitle className="pr-8">{name}</DialogTitle>
        <img
          src={url}
          alt={alt}
          className="max-h-[calc(100vh-8rem)] min-h-0 rounded-md object-contain"
        />
      </DialogContent>
    </Dialog>
  )
}
