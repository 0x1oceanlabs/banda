/**
 * A row's menu in Files (ADR 0073, decision 10): Open; Copy path, whole,
 * from the Project's folder or its name; and Pin or Unpin for a folder.
 * Open in an editor, Reveal and Add to chat come with step F2.
 */
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@banda/ui/components/dropdown-menu"
import { copyText } from "@banda/ui/lib/clipboard"
import { keyLabel } from "@banda/ui/lib/keys"
import {
  CopyIcon,
  FolderOpenIcon,
  FolderSearchIcon,
  PinIcon,
  PinOffIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react"
import { keyOf } from "./keys"
import { nameOf, within } from "./where"

export function RowMenu({
  whole,
  folder,
  top,
  pinned,
  onOpen,
  onShow,
  onPin,
}: {
  /** The row's whole path. */
  whole: string
  folder: boolean
  /** The Project's folder, whole: a path in it copies from it. */
  top: string | null
  /** Whether the folder is pinned among the places. */
  pinned?: boolean
  onOpen: () => void
  /** Shows it in its folder, from a list that is not its folder's. */
  onShow?: () => void
  onPin?: (pin: boolean) => void
}) {
  const relative = top === null ? null : within(top, whole)
  return (
    <>
      <DropdownMenuItem onClick={onOpen}>
        {folder ? <FolderOpenIcon /> : <SquareArrowOutUpRightIcon />}
        Open
        <DropdownMenuShortcut>{keyLabel(keyOf("open"))}</DropdownMenuShortcut>
      </DropdownMenuItem>
      {onShow && (
        <DropdownMenuItem onClick={onShow}>
          <FolderSearchIcon />
          Show in Files
        </DropdownMenuItem>
      )}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <CopyIcon />
          Copy path
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-44">
          <DropdownMenuItem onClick={() => copyText(whole)}>
            Full path
          </DropdownMenuItem>
          {relative && (
            <DropdownMenuItem onClick={() => copyText(relative)}>
              Relative path
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => copyText(nameOf(whole))}>
            Name
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {folder && onPin && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onPin(!pinned)}>
            {pinned ? <PinOffIcon /> : <PinIcon />}
            {pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
        </>
      )}
    </>
  )
}
