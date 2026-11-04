/** A filesystem path, rather than a URI or network address. */
export const localMedia = (src: string) =>
  !!src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("//")

type Node = {
  tagName?: string
  properties?: Record<string, unknown>
  data?: Record<string, unknown>
  children?: Node[]
}

/** rehype-harden resolves ./ and ../ as web paths. Keep sanitized local
 * image destinations apart while it checks web URLs, then restore them.
 * The temporary tag is created only after the HTML sanitizer ran. */
export function localImages(restore = false) {
  return () => (tree: Node) => {
    const visit = (node: Node) => {
      if (
        !restore &&
        node.tagName === "img" &&
        typeof node.properties?.src === "string" &&
        localMedia(node.properties.src)
      ) {
        node.tagName = "banda-local-media"
        node.data = { ...node.data, bandaLocal: true }
      } else if (
        restore &&
        node.tagName === "banda-local-media" &&
        node.data?.bandaLocal
      ) {
        node.tagName = "img"
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}
