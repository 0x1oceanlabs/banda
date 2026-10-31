/**
 * Images a message carries, as the window handles them: which files can
 * go, and how their bytes travel as text.
 */
import type { ImageData } from "@bandaso/contract/agents"

/** The kinds the engine takes, the largest image and the most per
 * message, as it checks them too. */
export const KINDS = ["image/png", "image/jpeg", "image/gif", "image/webp"]
const LARGEST = 10 * 1024 * 1024
export const MOST_IMAGES = 10

/** Why a file cannot go with a message, in plain words. */
export function problemWith(file: {
  type: string
  size: number
}): string | undefined {
  if (!KINDS.includes(file.type))
    return "A message can carry PNG, JPEG, GIF and WebP images."
  if (file.size > LARGEST) return "An image can be at most 10 MB."
  return undefined
}

/** The base64 bytes of a `data:` URL. */
export function base64Of(url: string): string {
  return url.slice(url.indexOf(",") + 1)
}

/** An image as a `data:` URL, which the window's pages may show. */
export function urlOf({ mime, data }: ImageData): string {
  return `data:${mime};base64,${data}`
}

/** The images among files a Person pasted or dropped. */
export function imagesAmong(files: Iterable<File>): File[] {
  return [...files].filter((file) => file.type.startsWith("image/"))
}
