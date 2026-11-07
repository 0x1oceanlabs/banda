import {
  ContextMenuContent,
  useAfterMenu,
} from "@banda/ui/components/context-menu"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@banda/ui/components/dropdown-menu"
import type {
  EditAct,
  PromptEditorHandle,
} from "@banda/ui/components/prompt-editor"
import { MOD } from "@banda/ui/lib/keys"
import {
  ClipboardIcon,
  ClipboardTypeIcon,
  CopyIcon,
  Redo2Icon,
  ScissorsIcon,
  SquareDashedIcon,
  Undo2Icon,
} from "lucide-react"

type Field = React.RefObject<PromptEditorHandle | null>

/**
 * The composer's menu at a right click (ADR 0063, decision 3): undo and
 * redo, cut, copy and paste, and select all. Each is dimmed while it has
 * nothing to act on. The window pastes, as the page never reads the
 * clipboard; none where no window does.
 */
export function ComposerMenu({
  field,
  paste,
}: {
  field: Field
  paste?: (plain: boolean) => void
}) {
  return (
    <ContextMenuContent aria-label="Message" className="min-w-56">
      <Items field={field} paste={paste} />
    </ContextMenuContent>
  )
}

/** The items, drawn as the menu opens: what the text allows then. */
function Items({
  field,
  paste,
}: {
  field: Field
  paste?: (plain: boolean) => void
}) {
  // Each acts on the text once the menu has given it the focus back.
  const later = useAfterMenu()
  const can = field.current?.can()
  const item = (
    icon: React.ReactNode,
    label: string,
    key: string,
    act: (() => void) | undefined
  ) => (
    <DropdownMenuItem disabled={!act} onClick={act && (() => later(act))}>
      {icon}
      {label}
      <DropdownMenuShortcut>{key}</DropdownMenuShortcut>
    </DropdownMenuItem>
  )
  const edit = (act: EditAct, allowed = true) =>
    allowed ? () => field.current?.edit(act) : undefined
  return (
    <>
      {item(<Undo2Icon />, "Undo", `${MOD}Z`, edit("undo", can?.undo))}
      {item(<Redo2Icon />, "Redo", `${MOD}Shift+Z`, edit("redo", can?.redo))}
      <DropdownMenuSeparator />
      {item(<ScissorsIcon />, "Cut", `${MOD}X`, edit("cut", can?.selected))}
      {item(<CopyIcon />, "Copy", `${MOD}C`, edit("copy", can?.selected))}
      {item(
        <ClipboardIcon />,
        "Paste",
        `${MOD}V`,
        paste && (() => paste(false))
      )}
      {item(
        <ClipboardTypeIcon />,
        "Paste as plain text",
        `${MOD}Shift+V`,
        paste && (() => paste(true))
      )}
      <DropdownMenuSeparator />
      {item(<SquareDashedIcon />, "Select all", `${MOD}A`, edit("selectAll"))}
    </>
  )
}
