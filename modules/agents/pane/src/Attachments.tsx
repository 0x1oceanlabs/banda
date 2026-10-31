import { useRef, useState } from "react"
import type { Image } from "@bandaso/contract/agents"
import { DialogTrigger } from "@bandaso/ui/components/dialog"
import { Spinner } from "@bandaso/ui/components/spinner"
import {
  Thumbnail,
  ThumbnailBusy,
  ThumbnailImage,
  ThumbnailRemove,
} from "@bandaso/ui/components/thumbnail"
import { problem as words } from "@bandaso/ui/lib/words"
import {
  base64Of,
  dataUrl,
  fitted,
  kindProblem,
  MOST_IMAGES,
  sizeProblem,
  UNNAMED,
} from "./images"
import { Preview } from "./Preview"

/** What `agents.attach` takes for one image. */
export type Attaching = { mime: string; data: string; name?: string }

/** An image the engine keeps for the message, and the URL it shows by. */
export type Attached = { image: Image; url: string }

/** An image a Person added, shown at once; `image` once the engine keeps
 * it. */
type Adding = {
  key: string
  name: string
  size: number
  url?: string
  image?: Image
}

/**
 * The images the message being written carries. Each goes to the engine
 * as soon as it is added, made smaller first when a side of it is longer
 * than T3 Code sends; sending then only names them. An image that cannot
 * go is left out, and `problem` says why. `closed` says why no image can
 * be added at all, such as a Harness that takes none.
 */
export function useAttachments({
  attach,
  closed,
}: {
  attach: (image: Attaching) => Promise<Image>
  closed?: string
}) {
  // The list as it is now, which the next add counts against; the state
  // shows it.
  const now = useRef<Adding[]>([])
  const [adding, setAdding] = useState<Adding[]>([])
  const [problem, setProblem] = useState<string>()
  const change = (to: (all: Adding[]) => Adding[]) => {
    now.current = to(now.current)
    setAdding(now.current)
  }
  const changeOne = (key: string, to: (one: Adding) => Adding | undefined) =>
    change((all) =>
      all.flatMap((one) => (one.key === key ? (to(one) ?? []) : [one]))
    )

  // Answers why the image cannot go, if it cannot.
  const add = async (key: string, file: File): Promise<string | undefined> => {
    const image = await fitted(file)
    const others = now.current
      .filter((one) => one.key !== key)
      .reduce((sum, one) => sum + one.size, 0)
    const wrong = sizeProblem(image.size, others)
    if (wrong) return wrong
    changeOne(key, (one) => ({ ...one, size: image.size }))
    const url = await dataUrl(image)
    changeOne(key, (one) => ({ ...one, url }))
    const kept = await attach({
      mime: image.type,
      data: base64Of(url),
      ...(file.name && { name: file.name }),
    })
    changeOne(key, (one) => ({ ...one, image: kept }))
    return undefined
  }

  return {
    adding,
    problem,
    /** Why no image can be added, if none can. */
    closed,
    /** Adds the files that can go; says why of one that cannot. */
    add: (files: File[]) => {
      setProblem(closed)
      if (closed) return
      for (const file of files) {
        const wrong =
          kindProblem(file.type) ??
          (now.current.length < MOST_IMAGES
            ? undefined
            : `A message can carry at most ${MOST_IMAGES} images.`)
        if (wrong) {
          setProblem(wrong)
          continue
        }
        const key = crypto.randomUUID()
        change((all) => [...all, { key, name: file.name, size: file.size }])
        const leave = (why: string) => {
          changeOne(key, () => undefined)
          setProblem(why)
        }
        add(key, file).then(
          (wrong) => {
            if (wrong) leave(wrong)
          },
          (error: unknown) => leave(words(error))
        )
      }
    },
    remove: (key: string) => changeOne(key, () => undefined),
    /** Takes away the images a message carried once it went. */
    sent: (images: Attached[]) => {
      const ids = new Set(images.map(({ image }) => image.id))
      change((all) => all.filter((one) => !one.image || !ids.has(one.image.id)))
      setProblem(undefined)
    },
    /** Some image is still on its way to the engine. */
    busy: adding.some((one) => !one.image),
    attached: adding.flatMap(({ image, url }): Attached[] =>
      image && url ? [{ image, url }] : []
    ),
  }
}

export type Attachments = ReturnType<typeof useAttachments>

/** The images the message carries, above its text: a press shows one
 * whole, and each can be taken away. */
export function AttachmentList({
  adding,
  onRemove,
}: {
  adding: Adding[]
  onRemove: (key: string) => void
}) {
  if (adding.length === 0) return null
  return (
    <ul aria-label="Images to send" className="flex flex-wrap gap-2">
      {adding.map(({ key, name, url, image }) => {
        const called = name || UNNAMED
        return (
          <li key={key}>
            <Thumbnail title={called}>
              {url && (
                <Preview name={called} url={url}>
                  <DialogTrigger
                    aria-label={`Open ${called}`}
                    className="block size-full cursor-zoom-in rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <ThumbnailImage src={url} alt={called} />
                  </DialogTrigger>
                </Preview>
              )}
              {!image && (
                <ThumbnailBusy>
                  <Spinner />
                </ThumbnailBusy>
              )}
              <ThumbnailRemove
                aria-label={`Remove ${called}`}
                onClick={() => onRemove(key)}
              />
            </Thumbnail>
          </li>
        )
      })}
    </ul>
  )
}
