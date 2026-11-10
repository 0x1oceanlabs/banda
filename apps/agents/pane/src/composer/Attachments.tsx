import { useEffect, useRef, useState } from "react"
import { type Params, Refused } from "@banda/contract"
import type { Image } from "@banda/contract/agents"
import { DialogTrigger } from "@banda/ui/components/dialog"
import { Spinner } from "@banda/ui/components/spinner"
import {
  Thumbnail,
  ThumbnailBusy,
  ThumbnailImage,
  ThumbnailRemove,
} from "@banda/ui/components/thumbnail"
import { cn } from "@banda/ui/lib/utils"
import { problem as words } from "@banda/ui/lib/words"
import { ImageOffIcon } from "lucide-react"
import {
  base64Of,
  dataUrl,
  fitted,
  kindProblem,
  MOST_IMAGES,
  sizeProblem,
  UNNAMED,
} from "./images"
import { type ImageReader, useUrl } from "../entries/parts/MessageImages"
import { ImagePreview } from "@banda/ui/components/image-preview"
import { useDraftImages } from "./drafts"

/** What `agents.attach` takes for one image. */
export type Attaching = Params<"agents.attach">

/** An image a Person added, shown at once: `image` once the engine keeps
 * it, `url` while it is on its way. */
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
 * than T3 Code sends; sending then only names them. Those the engine
 * keeps are the Thread's draft, so they wait with its text for the Person
 * to come back; one the engine no longer has leaves it. An image that
 * cannot go is left out, and `problem` says why. `closed` says why no
 * image can be added at all, such as a Harness that takes none.
 */
export function useAttachments({
  thread,
  attach,
  reader,
  closed,
}: {
  thread: string | null
  attach: (image: Attaching) => Promise<Image>
  reader: ImageReader
  closed?: string
}) {
  const [kept, setKept] = useDraftImages(thread)
  // The images still on their way, as they are now, which the next add
  // counts against; the state shows them.
  const now = useRef<Adding[]>([])
  const [going, setGoing] = useState<Adding[]>([])
  const [problem, setProblem] = useState<string>()
  // Each image joins the draft once those added before it have.
  const order = useRef(Promise.resolve())
  const change = (to: (all: Adding[]) => Adding[]) => {
    now.current = to(now.current)
    setGoing(now.current)
  }
  const changeOne = (key: string, to: (one: Adding) => Adding) =>
    change((all) => all.map((one) => (one.key === key ? to(one) : one)))
  const drop = (key: string) =>
    change((all) => all.filter((one) => one.key !== key))

  // An image kept for a draft that the engine let go leaves it.
  useEffect(() => {
    for (const { id } of kept)
      reader.read(id).catch((error: unknown) => {
        if (error instanceof Refused && error.refusal.code === "not_found")
          setKept((all) => all.filter((one) => one.id !== id))
      })
  }, [kept, reader, setKept])

  // The image as the engine keeps it, or why it cannot go.
  const add = async (key: string, file: File): Promise<Image | string> => {
    const image = await fitted(file)
    const others = [
      ...now.current.filter((one) => one.key !== key),
      ...kept,
    ].reduce((sum, one) => sum + one.size, 0)
    const wrong = sizeProblem(image.size, others)
    if (wrong) return wrong
    changeOne(key, (one) => ({ ...one, size: image.size }))
    const url = await dataUrl(image)
    changeOne(key, (one) => ({ ...one, url }))
    const done = await attach({
      mime: image.type,
      data: base64Of(url),
      ...(file.name && { name: file.name }),
    })
    reader.remember(done.id, url)
    return done
  }

  return {
    adding: [
      ...kept.map((image) => ({
        key: image.id,
        name: image.name ?? "",
        size: image.size,
        image,
      })),
      ...going,
    ],
    problem,
    reader,
    /** Adds the files that can go; says why of one that cannot. */
    add: (files: File[]) => {
      setProblem(closed)
      if (closed) return
      for (const file of files) {
        const wrong =
          kindProblem(file.type) ??
          (now.current.length + kept.length < MOST_IMAGES
            ? undefined
            : `A message can carry at most ${MOST_IMAGES} images.`)
        if (wrong) {
          setProblem(wrong)
          continue
        }
        const key = crypto.randomUUID()
        change((all) => [...all, { key, name: file.name, size: file.size }])
        const done = add(key, file).catch((error: unknown) =>
          words(error, "the image")
        )
        order.current = order.current
          .then(() => done)
          .then((done) => {
            // Taken away while it went.
            if (!now.current.some((one) => one.key === key)) return
            drop(key)
            if (typeof done === "string") setProblem(done)
            else setKept((all) => [...all, done])
          })
      }
    },
    remove: (key: string) => {
      drop(key)
      setKept((all) => all.filter((one) => one.id !== key))
      reader.forget(key)
    },
    /** Adds the images a message put back carried, as many as fit. */
    putBack: (images: Image[]) =>
      setKept((all) =>
        [
          ...all,
          ...images.filter((one) => !all.some((k) => k.id === one.id)),
        ].slice(0, MOST_IMAGES)
      ),
    /** Takes away the images a message carried once it went. */
    sent: (images: Image[]) => {
      const ids = new Set(images.map(({ id }) => id))
      setKept((all) => all.filter((one) => !ids.has(one.id)))
      setProblem(undefined)
    },
    /** Some image is still on its way to the engine. */
    busy: going.length > 0,
    /** The images the engine keeps for the message. */
    attached: kept,
  }
}

export type Attachments = ReturnType<typeof useAttachments>

/** The images the message carries, above its text: a press shows one
 * whole, and each can be taken away. */
export function AttachmentList({
  images: { adding, reader, remove },
}: {
  images: Attachments
}) {
  if (adding.length === 0) return null
  return (
    <ul aria-label="Images to send" className="flex flex-wrap gap-2">
      {adding.map((one) => (
        <li key={one.key}>
          <Attachment one={one} reader={reader} onRemove={remove} />
        </li>
      ))}
    </ul>
  )
}

function Attachment({
  one: { key, name, url: given, image },
  reader,
  onRemove,
}: {
  one: Adding
  reader: ImageReader
  onRemove: (key: string) => void
}) {
  // One the engine keeps is read from it, or from what the Pane read.
  const read = useUrl(reader, image?.id)
  const url = given ?? read
  const called = name || UNNAMED
  return (
    <Thumbnail
      title={url === null ? `${called} could not be shown.` : called}
      className={cn(
        url === null && "flex items-center justify-center text-muted-foreground"
      )}
    >
      {url && (
        <ImagePreview name={called} url={url}>
          <DialogTrigger
            aria-label={`Open ${called}`}
            className="block size-full cursor-zoom-in rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <ThumbnailImage src={url} alt={called} />
          </DialogTrigger>
        </ImagePreview>
      )}
      {(!image || url === undefined) && (
        <ThumbnailBusy>
          <Spinner />
        </ThumbnailBusy>
      )}
      {url === null && <ImageOffIcon className="size-5" />}
      <ThumbnailRemove
        aria-label={`Remove ${called}`}
        onClick={() => onRemove(key)}
      />
    </Thumbnail>
  )
}
