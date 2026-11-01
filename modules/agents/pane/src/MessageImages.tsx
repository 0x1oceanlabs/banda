import { useEffect, useMemo, useState } from "react"
import type { Engine, SpaceId } from "@banda/contract"
import type { Image, ImageData, ImageId } from "@banda/contract/agents"
import { DialogTrigger } from "@banda/ui/components/dialog"
import { Spinner } from "@banda/ui/components/spinner"
import {
  Thumbnail,
  ThumbnailBusy,
  ThumbnailImage,
} from "@banda/ui/components/thumbnail"
import { ImageOffIcon } from "lucide-react"
import { UNNAMED, urlOf } from "./images"
import { Preview } from "./Preview"

/** Shows the images a Thread's messages carry. */
export type ImageReader = {
  /** An image as a `data:` URL, read once while the Pane is open. */
  read: (image: ImageId) => Promise<string>
  /** Remembers a URL the window already has, such as for an image just
   * sent. */
  remember: (image: ImageId, url: string) => void
}

export function useImageReader(engine: Engine, space: SpaceId): ImageReader {
  return useMemo(() => {
    const urls = new Map<ImageId, Promise<string>>()
    return {
      read: (image) => {
        let url = urls.get(image)
        if (!url) {
          url = engine
            .call<ImageData>("agents.image", { image }, { space })
            .then(urlOf)
          // A read that failed goes again the next time.
          url.catch(() => urls.delete(image))
          urls.set(image, url)
        }
        return url
      },
      remember: (image, url) => urls.set(image, Promise.resolve(url)),
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
          <MessageImage image={image} reader={reader} />
        </li>
      ))}
    </ul>
  )
}

function MessageImage({
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
        className="flex size-24 items-center justify-center text-muted-foreground"
      >
        <ImageOffIcon className="size-5" />
      </Thumbnail>
    )
  if (url === undefined)
    return (
      <Thumbnail title={name} className="size-24">
        <ThumbnailBusy>
          <Spinner />
        </ThumbnailBusy>
      </Thumbnail>
    )
  return (
    <Preview name={name} url={url}>
      <Thumbnail
        render={<DialogTrigger />}
        aria-label={`Open ${name}`}
        title={name}
        className="size-24 cursor-zoom-in"
      >
        <ThumbnailImage src={url} alt={name} />
      </Thumbnail>
    </Preview>
  )
}

/** The image's URL once read: `undefined` while it is read, `null` when
 * it could not be. */
function useUrl(reader: ImageReader, image: ImageId) {
  const [read, setRead] = useState<{ image: ImageId; url: string | null }>()
  useEffect(() => {
    let current = true
    reader.read(image).then(
      (url) => current && setRead({ image, url }),
      () => current && setRead({ image, url: null })
    )
    return () => {
      current = false
    }
  }, [reader, image])
  return read?.image === image ? read.url : undefined
}
