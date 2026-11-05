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

/**
 * The terminal's menu, at a right click: the link there, then copy, paste,
 * select all and clear. A program that takes the mouse, as vim or htop,
 * hears the right click instead; with Shift the menu opens.
 */
export function TerminalMenu({
  at,
  follow,
  selectAll,
  type,
  paste,
}: {
  at: MenuAt
  follow: (target: Target, outside: boolean) => void
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
          <DropdownMenuItem onClick={() => follow(link, false)}>
            Open in Banda
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => follow(link, true)}>
            Open {outsideOf(link)}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => copy("page" in link ? link.page : link.file)}
          >
            {"page" in link ? "Copy address" : "Copy path"}
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
