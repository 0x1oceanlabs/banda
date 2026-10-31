import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@bandaso/ui/components/dialog"

/** An image shown whole over the Pane. `children` hold the
 * `DialogTrigger` that opens it. */
export function Preview({
  name,
  url,
  children,
}: {
  name: string
  url: string
  children: React.ReactNode
}) {
  return (
    <Dialog>
      {children}
      <DialogContent className="max-h-[calc(100%-2rem)] w-auto sm:max-w-[calc(100%-4rem)]">
        <DialogTitle className="pr-8">{name}</DialogTitle>
        <img
          src={url}
          alt={name}
          className="max-h-[calc(100vh-8rem)] min-h-0 rounded-md object-contain"
        />
      </DialogContent>
    </Dialog>
  )
}
