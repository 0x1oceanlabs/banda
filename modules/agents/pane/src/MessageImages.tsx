import { useEffect, useMemo, useState } from "react"
import type { Engine, SpaceId } from "@bandaso/contract"
import type { Image, ImageData, ImageId } from "@bandaso/contract/agents"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@bandaso/ui/components/dialog"
import { Spinner } from "@bandaso/ui/components/spinner"
import {
  Thumbnail,
  ThumbnailBusy,
  ThumbnailImage,
} from "@bandaso/ui/components/thumbnail"
import { ImageOffIcon } from "lucide-react"
import { urlOf } from "./images"

/** Shows the images a Thread's messages carry. */
export type ImageReader = {
  /** An image as a `data:` URL, read once while the Pane is open. */
  read: (image: ImageId) => Promise<string>
  /** Keeps a URL the window already has, such as for an image just sent. */
  keep: (image: ImageId, url: string) => void
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
      keep: (image, url) => urls.set(image, Promise.resolve(url)),
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
  const name = image.name ?? "Image"
  if (url === null)
    return (
      <Thumbnail
        title={`${name} could not be shown.`}
        className="flex size-24 items-center justify-center text-muted-foreground"
      >
        <ImageOffIcon className="size-5" />
      </Thumbnail>
    )
  return (
    <Dialog>
      <Thumbnail
        render={<DialogTrigger />}
        aria-label={`Open ${name}`}
        title={name}
        className="size-24 cursor-zoom-in"
      >
        {url ? (
          <ThumbnailImage src={url} alt={name} />
        ) : (
          <ThumbnailBusy>
            <Spinner />
          </ThumbnailBusy>
        )}
      </Thumbnail>
      <DialogContent className="max-h-[calc(100%-2rem)] w-auto sm:max-w-[calc(100%-4rem)]">
        <DialogTitle className="pr-8">{name}</DialogTitle>
        {url && (
          <img
            src={url}
            alt={name}
            className="max-h-[calc(100vh-8rem)] min-h-0 rounded-md object-contain"
          />
        )}
      </DialogContent>
    </Dialog>
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
