/** A control in the composer's footer (ADR 0058, decision 8): 28px with a
 * button's corner, its words meta-sized, muted until hovered or open;
 * its hover the raised fill, which shows on the composer's block. For a
 * ghost `Button` of size `sm`. */
export const FOOTER_CONTROL =
  "h-7 gap-1.5 rounded-control px-2 text-xs font-normal text-muted-foreground hover:bg-raised hover:text-foreground aria-expanded:bg-raised aria-expanded:text-foreground dark:hover:bg-raised"

/** {@link FOOTER_CONTROL} with only an icon, for a ghost `Button` of size
 * `icon-sm`. */
export const FOOTER_ICON =
  "rounded-control text-muted-foreground hover:bg-raised hover:text-foreground aria-expanded:bg-raised aria-expanded:text-foreground dark:hover:bg-raised [&_svg:not([class*='size-'])]:size-3.5"
