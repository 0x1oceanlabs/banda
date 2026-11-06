/** A file's bytes as the window sends them to the engine. */

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
