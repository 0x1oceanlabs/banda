import {
  ContextMenuContent,
  useAfterMenu,
} from "@banda/ui/components/context-menu"
import { copyText as copy } from "@banda/ui/lib/clipboard"
import { isMac as mac } from "@banda/ui/lib/keys"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@banda/ui/components/dropdown-menu"
import { outsideOf, type Target } from "./links"

/** Where the menu opened: the link there, and the text selected then. */
export type MenuAt = { link: Target | null; selection: string }

/** Where a link opens from this Pane, where Banda's browser cannot: in
 * words for a row, as "in this Mac's browser". */
export const THIS_DEVICE = mac ? "this Mac" : "this computer"

/**
 * The terminal's menu, at a right click: the link there, then copy, paste,
 * select all and clear. A program that takes the mouse, as vim or htop,
 * hears the right click instead; with Shift the menu opens.
 */
export function TerminalMenu({
  at,
  follow,
  inBanda,
  opensHere,
  selectAll,
  type,
  paste,
}: {
  at: MenuAt
  follow: (target: Target, outside: boolean) => void
  /** Whether a link there opens in Banda's browser too. */
  inBanda: (target: Target) => boolean
  /** Whether a link there opens from this device at all, which arc's
   * `localhost` does not: it offers its address alone. */
  opensHere: (target: Target) => boolean
  selectAll: () => void
  /** Types to the program, as a key would. */
  type: (data: string) => void
  /** Pastes what the clipboard holds; none where no window does. */
  paste?: () => void
}) {
  const { link } = at
  // Pasting waits for the screen to have its focus back.
  const later = useAfterMenu()
  return (
    // The menu gives the screen its focus back as it closes (ContextMenu).
    <ContextMenuContent aria-label="Terminal">
      {link && (
        <>
          {inBanda(link) && (
            <DropdownMenuItem onClick={() => follow(link, false)}>
              Open in Banda
            </DropdownMenuItem>
          )}
          {opensHere(link) && (
            <DropdownMenuItem onClick={() => follow(link, true)}>
              Open{" "}
              {inBanda(link) ? outsideOf(link) : `in ${THIS_DEVICE}'s browser`}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => copy("link" in link ? link.link.url : link.file)}
          >
            {"link" in link ? "Copy address" : "Copy path"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem
        disabled={!at.selection}
        onClick={() => copy(at.selection)}
      >
        Copy
        <DropdownMenuShortcut>
          {mac ? "⌘C" : "Ctrl+Shift+C"}
        </DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!paste}
        onClick={paste && (() => later(paste))}
      >
        Paste
        <DropdownMenuShortcut>
          {mac ? "⌘V" : "Ctrl+Shift+V"}
        </DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={selectAll}>Select all</DropdownMenuItem>
      <DropdownMenuSeparator />
      {/* As Ctrl+L: the shell clears its screen and draws its prompt again. */}
      <DropdownMenuItem onClick={() => type("\f")}>
        Clear
        <DropdownMenuShortcut>Ctrl+L</DropdownMenuShortcut>
      </DropdownMenuItem>
    </ContextMenuContent>
  )
}
