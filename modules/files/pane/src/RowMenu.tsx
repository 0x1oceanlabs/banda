/**
 * A row's menu in Files (ADR 0073, decision 10): Open; Quick Look; Open in the editor
 * `files.toml` names, and in the others found; Open with the system;
 * Reveal in the system's file manager; Add to chat; Copy path, whole, from
 * the Project's folder or its name; and Pin or Unpin for a folder. The
 * file operations come later (step F5).
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
  FILE_MANAGER,
  openInEditor,
  openWithSystem,
  reveal,
  useEditors,
} from "@banda/ui/lib/outside"
import {
  AppWindowIcon,
  AtSignIcon,
  CopyIcon,
  EyeIcon,
  FolderDownIcon,
  FolderOpenIcon,
  FolderSearchIcon,
  PinIcon,
  PinOffIcon,
  SquareArrowOutUpRightIcon,
  SquareCodeIcon,
} from "lucide-react"
import { keyOf } from "./keys"
import { nameOf, within } from "./where"

export function RowMenu({
  whole,
  folder,
  top,
  pinned,
  onOpen,
  onPeek,
  onShow,
  onAttach,
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
  /** Shows it in Quick Look, over the desk. */
  onPeek?: () => void
  /** Shows it in its folder, from a list that is not its folder's. */
  onShow?: () => void
  /** Names it in a Thread's message, with the other rows picked. */
  onAttach: () => void
  onPin?: (pin: boolean) => void
}) {
  const relative = top === null ? null : within(top, whole)
  const { editor, others } = useEditors()
  return (
    <>
      <DropdownMenuItem onClick={onOpen}>
        {folder ? <FolderOpenIcon /> : <SquareArrowOutUpRightIcon />}
        Open
        <DropdownMenuShortcut>{keyLabel(keyOf("open"))}</DropdownMenuShortcut>
      </DropdownMenuItem>
      {onPeek && (
        <DropdownMenuItem onClick={onPeek}>
          <EyeIcon />
          Quick Look
          <DropdownMenuShortcut>{keyLabel(keyOf("peek"))}</DropdownMenuShortcut>
        </DropdownMenuItem>
      )}
      {onShow && (
        <DropdownMenuItem onClick={onShow}>
          <FolderSearchIcon />
          Show in Files
        </DropdownMenuItem>
      )}
      {editor && (
        <DropdownMenuItem onClick={() => void openInEditor(whole)}>
          <SquareCodeIcon />
          Open in {editor.name}
        </DropdownMenuItem>
      )}
      {others.length > 0 && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SquareCodeIcon />
            Open in
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-40">
            {others.map((other) => (
              <DropdownMenuItem
                key={other.id}
                onClick={() => void openInEditor(whole, {}, other.id)}
              >
                {other.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      {!folder && (
        <DropdownMenuItem onClick={() => openWithSystem(whole)}>
          <AppWindowIcon />
          Open with the system
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={() => reveal(whole)}>
        <FolderDownIcon />
        Reveal in {FILE_MANAGER}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onAttach}>
        <AtSignIcon />
        Add to chat
      </DropdownMenuItem>
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
