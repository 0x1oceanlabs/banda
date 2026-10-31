import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cn } from "cn"
import { XIcon } from "lucide-react"

/** A small picture in a frame: an image waiting to be sent, or one a
 * message carries. Holds a `ThumbnailImage`, and maybe a
 * `ThumbnailRemove` or a `ThumbnailBusy` while it loads. Rendered as a
 * button, it opens the picture. */
function Thumbnail({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "group/thumbnail relative block size-16 shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className
        ),
      },
      props
    ),
    render,
    state: { slot: "thumbnail" },
  })
}

function ThumbnailImage({
  className,
  alt,
  ...props
}: React.ComponentProps<"img">) {
  return (
    <img
      data-slot="thumbnail-image"
      alt={alt}
      className={cn("size-full object-cover", className)}
      {...props}
    />
  )
}

/** Takes the picture away; shows on hover and on focus. */
function ThumbnailRemove({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="thumbnail-remove"
      className={cn(
        "absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-background/90 text-foreground opacity-0 shadow-sm ring-1 ring-foreground/10 transition-opacity outline-none group-hover/thumbnail:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3",
        className
      )}
      {...props}
    >
      <XIcon />
    </button>
  )
}

/** Covers the picture while it is busy, such as being added. */
function ThumbnailBusy({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="thumbnail-busy"
      className={cn(
        "absolute inset-0 flex items-center justify-center bg-background/60",
        className
      )}
      {...props}
    />
  )
}

export { Thumbnail, ThumbnailBusy, ThumbnailImage, ThumbnailRemove }
