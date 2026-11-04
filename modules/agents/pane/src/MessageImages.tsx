import { useEffect, useMemo, useState } from "react"
import type { Engine, SpaceId } from "@banda/contract"
import type { Image, ImageId } from "@banda/contract/agents"
import { DialogTrigger } from "@banda/ui/components/dialog"
import { Spinner } from "@banda/ui/components/spinner"
import {
  Thumbnail,
  ThumbnailBusy,
  ThumbnailImage,
} from "@banda/ui/components/thumbnail"
import { ImageOffIcon } from "lucide-react"
import { UNNAMED, urlOf } from "./images"
import { ImagePreview } from "@banda/ui/components/image-preview"

/** Shows the images a Thread's messages carry. */
export type ImageReader = {
  /** An image as a `data:` URL, read once while the Pane is open. */
  read: (image: ImageId) => Promise<string>
  /** Remembers a URL the window already has, such as for an image just
   * added. */
  remember: (image: ImageId, url: string) => void
  /** The URL already read, if it is. */
  peek: (image: ImageId) => string | undefined
  /** Lets go of an image's URL, such as one taken off the message. */
  forget: (image: ImageId) => void
}

export function useImageReader(engine: Engine, space: SpaceId): ImageReader {
  return useMemo(() => {
    const urls = new Map<ImageId, Promise<string>>()
    const ready = new Map<ImageId, string>()
    return {
      read: (image) => {
        let url = urls.get(image)
        if (!url) {
          url = engine.call("agents.image", { image }, { space }).then(urlOf)
          url.then(
            (read) => ready.set(image, read),
            // A read that failed goes again the next time.
            () => urls.delete(image)
          )
          urls.set(image, url)
        }
        return url
      },
      remember: (image, url) => {
        urls.set(image, Promise.resolve(url))
        ready.set(image, url)
      },
      peek: (image) => ready.get(image),
      forget: (image) => {
        urls.delete(image)
        ready.delete(image)
      },
    }
  }, [engine, space])
}

/** The images a message carries, above its text: a press shows one
 * whole. */
export function MessageImages({
  images,
  reader,
}: {
  images: Image[]
  reader: ImageReader
}) {
  if (images.length === 0) return null
  return (
    <ul aria-label="Images" className="flex flex-wrap justify-end gap-2">
      {images.map((image) => (
        <li key={image.id}>
          <ThreadImage image={image} reader={reader} />
        </li>
      ))}
    </ul>
  )
}

export function ThreadImage({
  image,
  reader,
}: {
  image: Image
  reader: ImageReader
}) {
  const url = useUrl(reader, image.id)
  const name = image.name ?? UNNAMED
  if (url === null)
    return (
      <Thumbnail
        title={`${name} could not be shown.`}
        size="lg"
        className="flex items-center justify-center text-muted-foreground"
      >
        <ImageOffIcon className="size-5" />
      </Thumbnail>
    )
  if (url === undefined)
    return (
      <Thumbnail title={name} size="lg">
        <ThumbnailBusy>
          <Spinner />
        </ThumbnailBusy>
      </Thumbnail>
    )
  return (
    <ImagePreview name={name} url={url}>
      <Thumbnail
        render={<DialogTrigger />}
        aria-label={`Open ${name}`}
        title={name}
        size="lg"
        className="cursor-zoom-in"
      >
        <ThumbnailImage src={url} alt={name} />
      </Thumbnail>
    </ImagePreview>
  )
}

/** The image's URL once read: `undefined` while it is read, `null` when
 * it could not be. */
export function useUrl(reader: ImageReader, image: ImageId | undefined) {
  const [read, setRead] = useState<{ image: ImageId; url: string | null }>()
  useEffect(() => {
    if (image === undefined) return
    let current = true
    reader.read(image).then(
      (url) => current && setRead({ image, url }),
      () => current && setRead({ image, url: null })
    )
    return () => {
      current = false
    }
  }, [reader, image])
  if (image === undefined) return undefined
  return read?.image === image ? read.url : reader.peek(image)
}
