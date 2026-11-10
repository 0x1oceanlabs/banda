import { Dialog, DialogContent, DialogTitle } from "./dialog"

/** An image shown whole over the Pane. `children` hold the
 * `DialogTrigger` that opens it. */
export function ImagePreview({
  name,
  url,
  children,
  alt = name,
}: {
  name: string
  url: string
  alt?: string
  children: React.ReactNode
}) {
  return (
    <Dialog>
      {children}
      <DialogContent className="max-h-[calc(100%-2rem)] w-auto sm:max-w-[calc(100%-4rem)]">
        <DialogTitle className="pr-8">{name}</DialogTitle>
        <img
          src={url}
          alt={alt}
          className="max-h-[calc(100vh-8rem)] min-h-0 rounded-control object-contain"
        />
      </DialogContent>
    </Dialog>
  )
}
