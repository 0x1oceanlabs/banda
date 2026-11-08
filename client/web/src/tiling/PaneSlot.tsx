import { type HeaderProps, useSlot } from "@banda/ui/slots"

/**
 * The Slot `pane.header` (ADR 0062, decision 17): what the Apps show of a
 * Pane where its header puts it (`at`), each in the modules' order, the
 * Window's own first. The Tiling draws it in a Pane's header and on its
 * tile in the Overview, and knows nothing of what each shows: a Thread's
 * Mark is Threads', another machine's name the Window's. With nothing to
 * show, it draws nothing.
 */
export function PaneSlot(props: HeaderProps) {
  return useSlot("pane.header").map(({ id, Fill }) => (
    <Fill key={id} {...props} />
  ))
}
