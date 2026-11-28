/** Viewport images for browser_screenshot (ADR 0061). Masking happens in
 * the page before rasterization, including fields in child frames. How
 * the picture is bounded is its taker's: the window shrinks it with
 * Electron's `nativeImage`, the driver's viewport is small enough
 * already. */
import type { Screenshot } from "@banda/contract/browser"
import type { Page } from "playwright-core"
import type { Dialogs } from "./dialogs"
import { timedOut } from "./hands"
import { messageOf, Refusal } from "./refusal"

const FIELDS = [
  'input[type="password" i]',
  ...[
    "current-password",
    "new-password",
    "cc-number",
    "cc-exp",
    "cc-exp-month",
    "cc-exp-year",
    "cc-csc",
  ].map((field) => `[autocomplete~="${field}" i]`),
].join(",")

/** The longest edge of a picture, and the most it weighs. */
export const EDGE = 1280
export const BYTES = 1024 * 1024

/** A picture of what `page` shows, in its CSS pixels, with its password
 * and card fields blacked out: a PNG, or a JPEG of `quality`. */
export const picture = (page: Page, quality?: number): Promise<Buffer> =>
  page.screenshot({
    ...(quality === undefined ? { type: "png" } : { type: "jpeg", quality }),
    scale: "css",
    fullPage: false,
    timeout: 8_000,
    mask: page.frames().map((frame) => frame.locator(FIELDS)),
    maskColor: "#000000",
  })

/** A bounded picture, as a screenshot answers it. */
export type Image = Pick<Screenshot, "width" | "height" | "pictures">

/** The page shows a dialog: no picture is taken of it. */
export const dialogOpen = () =>
  new Refusal({
    code: "conflict",
    message:
      "The page has an open dialog. Answer it before taking a screenshot.",
  })

const navigatedMeanwhile = () =>
  new Refusal({
    code: "conflict",
    message:
      "The page navigated during capture. Take a new snapshot and try again.",
  })

/** Refuses a picture of a page that is not at `url` any more. */
export function sameAddress(url: string, now: string | undefined) {
  if (now !== url) throw navigatedMeanwhile()
}

/** What `take` pictures of `page`, and the address it was at: refused
 * when the page opened a dialog or went elsewhere meanwhile, as the
 * picture may then show another page than the answer names. `uncaptured`
 * says what to do when the viewport gave no picture. */
export async function captured(
  page: Page,
  dialogs: Dialogs,
  take: (page: Page) => Promise<Image>,
  uncaptured: string
): Promise<Image & { url: string }> {
  if (dialogs.current()) throw dialogOpen()
  const url = page.url()
  const next = dialogs.watch()
  let navigated = false
  const moved = () => {
    navigated = true
  }
  page.on("framenavigated", moved)
  let image: Image
  try {
    const taking = take(page).catch((error: unknown) => {
      if (
        timedOut(error) ||
        messageOf(error).includes("Unable to capture screenshot")
      )
        throw new Refusal({
          code: "conflict",
          message: `The viewport could not be captured. ${uncaptured}`,
        })
      throw error
    })
    taking.catch(() => {})
    image = await Promise.race([
      taking,
      next.opened.then(() => {
        throw new Refusal({
          code: "conflict",
          message:
            "The page opened a dialog during capture. Answer it and try again.",
        })
      }),
    ])
  } finally {
    page.off("framenavigated", moved)
    next.stop()
  }
  if (navigated) throw navigatedMeanwhile()
  sameAddress(url, page.url())
  return { ...image, url }
}

/** A picture of `page` for the driver: a JPEG, of less quality until it
 * weighs `BYTES` at most. Its viewport is no longer than `EDGE`. */
export async function capture(page: Page): Promise<Image> {
  const { width, height } = page.viewportSize() ?? { width: 0, height: 0 }
  for (let quality = 80; ; quality -= 20) {
    const jpeg = await picture(page, quality)
    if (jpeg.length > BYTES && quality > 20) continue
    if (jpeg.length > BYTES)
      throw new Refusal({ message: "The page's picture is too large to send." })
    return {
      width,
      height,
      pictures: [{ mime: "image/jpeg", data: jpeg.toString("base64") }],
    }
  }
}
