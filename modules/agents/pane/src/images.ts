/**
 * Images a message carries, as the window handles them: which files can
 * go, how large ones are made smaller, and how their bytes travel as text.
 */
import type { ImageData } from "@banda/contract/agents"

const MB = 1024 * 1024
/** The kinds the engine takes; the largest image, the most per message
 * and the most of their bytes together, as in T3 Code. The engine checks
 * them too. */
const KINDS = ["image/png", "image/jpeg", "image/gif", "image/webp"]
const LARGEST = 10 * MB
export const MOST_IMAGES = 100
const MOST_BYTES = 80 * MB
/** The longest side of a PNG or JPEG a message carries, as in T3 Code:
 * Claude refuses larger ones once a request holds many images, and a
 * Thread keeps sending what it was sent. */
const LONGEST_SIDE = 2000

/** Why a file of `type` cannot go with a message, in plain words. */
export function kindProblem(type: string): string | undefined {
  return KINDS.includes(type)
    ? undefined
    : "A message can carry PNG, JPEG, GIF and WebP images."
}

/** Why an image of `size` bytes cannot join others of `others` bytes. */
export function sizeProblem(size: number, others: number): string | undefined {
  if (size > LARGEST) return `An image can be at most ${LARGEST / MB} MB.`
  if (size + others > MOST_BYTES)
    return `A message's images can be at most ${MOST_BYTES / MB} MB together.`
  return undefined
}

/** The size an image is made to when a side of it is longer than
 * T3 Code sends. */
export function fitSize({
  width,
  height,
}: {
  width: number
  height: number
}): { width: number; height: number } | undefined {
  const longest = Math.max(width, height)
  if (longest <= LONGEST_SIDE) return undefined
  const scale = LONGEST_SIDE / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** A PNG or JPEG made to fit in {@link fitSize}; any other file, or one
 * that cannot be drawn, as it is. */
export async function fitted(file: File): Promise<File> {
  if (file.type !== "image/png" && file.type !== "image/jpeg") return file
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
    const size = fitSize(bitmap)
    if (!size) return file
    const canvas = new OffscreenCanvas(size.width, size.height)
    const context = canvas.getContext("2d")
    if (!context) return file
    context.imageSmoothingQuality = "high"
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    const blob = await canvas.convertToBlob({ type: file.type, quality: 0.9 })
    return new File([blob], file.name, { type: file.type })
  } catch {
    return file
  } finally {
    bitmap?.close()
  }
}

/** A file's bytes as a `data:` URL. */
export function dataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error("unreadable"))
    reader.readAsDataURL(file)
  })
}

/** The base64 bytes of a `data:` URL. */
export function base64Of(url: string): string {
  return url.slice(url.indexOf(",") + 1)
}

/** An image as a `data:` URL, which the window's pages may show. */
export function urlOf({ mime, data }: ImageData): string {
  return `data:${mime};base64,${data}`
}

/** The images among files a Person pasted. */
export function imagesAmong(files: Iterable<File>): File[] {
  return [...files].filter((file) => file.type.startsWith("image/"))
}

/** What an image is called where it has no name of its own. */
export const UNNAMED = "An image"
