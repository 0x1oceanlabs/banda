import { useState } from "react"
import type { Image } from "@bandaso/contract/agents"
import { Spinner } from "@bandaso/ui/components/spinner"
import { problem as words } from "@bandaso/ui/lib/words"
import {
  Thumbnail,
  ThumbnailBusy,
  ThumbnailImage,
  ThumbnailRemove,
} from "@bandaso/ui/components/thumbnail"
import { base64Of, MOST_IMAGES, problemWith } from "./images"

/** An image a Person added to the message they write: shown at once,
 * kept by the engine once `image` is set. */
type Attached = { key: string; name: string; url?: string; image?: Image }

/** What `add` hands the engine for one image. */
export type Adding = { mime: string; data: string; name?: string }

/** An image the engine keeps, and how the window shows it. */
export type Kept = { image: Image; url: string }

/**
 * The images the message being written carries. Each goes to the engine
 * as soon as it is added (`add` keeps it there and answers what it kept),
 * so sending only names them. An image that cannot be read or kept is
 * dropped, and `problem` says why.
 */
export function useAttachments(add: (image: Adding) => Promise<Image>) {
  const [attached, setAttached] = useState<Attached[]>([])
  const [problem, setProblem] = useState<string>()

  const change = (key: string, to: (one: Attached) => Attached | undefined) =>
    setAttached((all) =>
      all.flatMap((one) => (one.key === key ? (to(one) ?? []) : [one]))
    )

  const addFiles = (files: File[]) => {
    setProblem(undefined)
    const room = MOST_IMAGES - attached.length
    if (files.length > room)
      setProblem(`A message can carry at most ${MOST_IMAGES} images.`)
    for (const file of files.slice(0, Math.max(room, 0))) {
      const wrong = problemWith(file)
      if (wrong) {
        setProblem(wrong)
        continue
      }
      const key = crypto.randomUUID()
      setAttached((all) => [...all, { key, name: file.name }])
      read(file)
        .then(async (url) => {
          change(key, (one) => ({ ...one, url }))
          const image = await add({
            mime: file.type,
            data: base64Of(url),
            ...(file.name && { name: file.name }),
          })
          change(key, (one) => ({ ...one, image }))
        })
        .catch((error: unknown) => {
          change(key, () => undefined)
          setProblem(words(error))
        })
    }
  }

  return {
    attached,
    problem,
    add: addFiles,
    remove: (key: string) => change(key, () => undefined),
    clear: () => {
      setAttached([])
      setProblem(undefined)
    },
    /** Some image is still on its way to the engine. */
    busy: attached.some((one) => !one.image),
    kept: attached.flatMap(({ image, url }): Kept[] =>
      image && url ? [{ image, url }] : []
    ),
  }
}

function read(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error("unreadable"))
    reader.readAsDataURL(file)
  })
}

/** The images the message carries, above its text; each can be taken
 * away. */
export function Attachments({
  attached,
  onRemove,
}: {
  attached: Attached[]
  onRemove: (key: string) => void
}) {
  if (attached.length === 0) return null
  return (
    <ul aria-label="Images to send" className="flex flex-wrap gap-2">
      {attached.map(({ key, name, url, image }) => (
        <li key={key}>
          <Thumbnail title={name}>
            {url && <ThumbnailImage src={url} alt={name || "An image"} />}
            {!image && (
              <ThumbnailBusy>
                <Spinner />
              </ThumbnailBusy>
            )}
            <ThumbnailRemove
              aria-label={`Remove ${name || "the image"}`}
              onClick={() => onRemove(key)}
            />
          </Thumbnail>
        </li>
      ))}
    </ul>
  )
}
