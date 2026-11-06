/**
 * A file's icon by its name, as Files' tree draws it (ADR 0073, decision
 * 14): Pierre's standard set, in the text's colour, for a list that is not
 * Pierre's tree, as Files' columns and its gallery. Its sprite is put in
 * the page once, as the first icon is drawn.
 */
import {
  createFileTreeIconResolver,
  getBuiltInSpriteSheet,
} from "@pierre/trees"
import { cn } from "../lib/utils"

const SET = "standard"
const icons = createFileTreeIconResolver({ set: SET, colored: false })

/** Whether the sprite is in the page. */
let put = false

/** Puts Pierre's sprite in the page, hidden, once: its own markup, which
 * the page's parser reads as SVG. */
function putSprite(): void {
  if (put || typeof document === "undefined") return
  put = true
  const sprite = document.createElement("template")
  sprite.innerHTML = getBuiltInSpriteSheet(SET)
  for (const svg of sprite.content.querySelectorAll("svg"))
    svg.setAttribute("style", "position:absolute;width:0;height:0")
  document.body.append(sprite.content)
}

/** The id of the icon a file named `path` is drawn with. */
export function fileIconName(path: string): string {
  return icons.resolveIcon("file-tree-icon-file", path).name
}

export function FileIcon({
  path,
  className,
}: {
  /** Its name, or a path that ends with it. */
  path: string
  className?: string
}) {
  putSprite()
  return (
    <svg
      aria-hidden
      data-slot="file-icon"
      className={cn("size-3.5 shrink-0", className)}
    >
      <use href={`#${fileIconName(path)}`} />
    </svg>
  )
}
