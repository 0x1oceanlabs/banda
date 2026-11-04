/** Viewport images for browser_screenshot (ADR 0061). Masking happens in
 * the page before rasterization, including fields in child frames. */
import { nativeImage } from "electron"
import type { Page } from "playwright-core"
import type { Screenshot } from "@banda/contract/browser"

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
const EDGE = 1280
const BYTES = 1024 * 1024

export async function capture(
  page: Page
): Promise<Pick<Screenshot, "width" | "height" | "pictures">> {
  const png = await page.screenshot({
    type: "png",
    scale: "css",
    fullPage: false,
    timeout: 8_000,
    mask: page.frames().map((frame) => frame.locator(FIELDS)),
    maskColor: "#000000",
  })
  let image = nativeImage.createFromBuffer(png)
  const size = image.getSize()
  if (Math.max(size.width, size.height) > EDGE) {
    image = image.resize(
      size.width >= size.height
        ? { width: EDGE, quality: "best" }
        : { height: EDGE, quality: "best" }
    )
  }
  let jpeg = image.toJPEG(80)
  while (jpeg.length > BYTES) {
    image = image.resize({
      width: Math.max(1, Math.floor(image.getSize().width * 0.75)),
      quality: "best",
    })
    jpeg = image.toJPEG(80)
  }
  const { width, height } = image.getSize()
  return {
    width,
    height,
    pictures: [{ mime: "image/jpeg", data: jpeg.toString("base64") }],
  }
}
