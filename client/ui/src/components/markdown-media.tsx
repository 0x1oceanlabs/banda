import { type Mint, useMinted } from "../hooks/use-file-url"
import { localPath } from "../lib/file-links"
import { createContext, useContext, useState } from "react"
import { DialogTrigger } from "./dialog"
import { ImagePreview } from "./image-preview"

/** The engine gives a token for a local path, which the Pane names as a
 * URL; markdown never reads the filesystem. */
const Resolver = createContext<Mint | null>(null)
export function MarkdownMedia({
  resolve,
  children,
}: {
  resolve: Mint
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

/** An image a reply shows: a web one as it is, a local file embedded.
 * Whatever a local one shows, Copy writes it as it was written (ADR
 * 0063, decision 4). */
export function MarkdownImage({
  src,
  alt = "",
}: {
  src?: string | Blob
  alt?: string
}) {
  const path = typeof src === "string" ? src : ""
  if (!localPath(path)) return <img src={path} alt={alt} />
  return (
    <span className="contents" data-media={path} data-alt={alt}>
      <LocalMedia path={path} alt={alt} />
    </span>
  )
}

/** An embedded local file. A refusal stays readable as a file link;
 * playback is always the Person's, never automatic. */
function LocalMedia({ path, alt }: { path: string; alt: string }) {
  const resolve = useContext(Resolver)
  const kind = kindOf(path)
  // Renewed while mounted; a persisted reply never keeps an expired URL.
  const given = useMinted(kind ? resolve : null, path)
  // The URL the file failed to load from, until the next.
  const [broken, setBroken] = useState<string | null>(null)
  const url = given === broken ? null : given
  const name = alt || path.split("/").at(-1) || path
  if (url === null)
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
  if (url === undefined)
    return (
      <span role="status" className="text-muted-foreground">
        Loading {name}…
      </span>
    )
  const unavailable = () => setBroken(url)
  if (kind === "video")
    return (
      <video
        src={url}
        aria-label={name}
        controls
        preload="metadata"
        onError={unavailable}
        className="my-2 max-h-96 max-w-full rounded-control"
      />
    )
  if (kind === "audio")
    return (
      <span className="my-2 flex max-w-full flex-col gap-1">
        <span className="text-meta text-muted-foreground">{name}</span>
        <audio
          src={url}
          aria-label={name}
          controls
          preload="metadata"
          onError={unavailable}
          className="max-w-full"
        />
      </span>
    )
  return (
    <ImagePreview name={name} url={url} alt={alt}>
      <DialogTrigger
        aria-label={`Open ${name}`}
        className="my-2 block max-w-full cursor-zoom-in rounded-control focus-visible:ring-2 focus-visible:ring-ring"
      >
        <img
          src={url}
          alt={alt}
          onError={unavailable}
          loading="lazy"
          className="max-h-96 max-w-full rounded-control object-contain"
        />
      </DialogTrigger>
    </ImagePreview>
  )
}
