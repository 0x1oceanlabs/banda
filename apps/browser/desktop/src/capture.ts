/** The window's viewport images for browser_screenshot (ADR 0061): the
 * page's picture, masked as `@banda/browser-driver` takes it, shrunk to
 * its bounds with Electron's own image. */
import { BYTES, EDGE, type Image, picture } from "@banda/browser-driver"
import { nativeImage } from "electron"
import type { Page } from "playwright-core"

export async function capture(page: Page): Promise<Image> {
  const png = await picture(page)
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
