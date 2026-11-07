/**
 * A row's menu in Files (ADR 0073, decision 10): Open; Quick Look; Open in the editor
 * `files.toml` names, and in the others found; Open with the system;
 * Reveal in the system's file manager; Add to chat; Copy path, whole, from
 * the Project's folder or its name; New file and New folder beside it, or
 * in it; Rename, Duplicate, Copy, Cut and Paste; Move to Trash; and Pin
 * or Unpin for a folder. Each operation says its key in force, the
 * Pane's own.
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
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
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
  ClipboardPasteIcon,
  CopyIcon,
  CopyPlusIcon,
  EyeIcon,
  FilePlusIcon,
  FilesIcon,
  FolderDownIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FolderSearchIcon,
  PencilLineIcon,
  PinIcon,
  PinOffIcon,
  ScissorsIcon,
  SquareArrowOutUpRightIcon,
  SquareCodeIcon,
  Trash2Icon,
} from "lucide-react"
import type { ReactNode } from "react"
import { type Does, idOf } from "./keys"
import { nameOf, within } from "./where"

/** What a row's menu does to files. */
export type Acts = {
  /** What it offers. */
  offers: readonly Does[]
  run: (does: Does) => void
  /** How many rows it acts on: "Rename…" for several. */
  count: number
}

/** The operations a menu lists, in groups between lines, each with its
 * icon and its words. */
const MAKING: readonly Does[] = ["new-file", "new-folder"]
const CHANGING: readonly Does[] = [
  "rename",
  "duplicate",
  "copy",
  "cut",
  "paste",
]
const SHOWN: Partial<Record<Does, { icon: ReactNode; words: string }>> = {
  "new-file": { icon: <FilePlusIcon />, words: "New file" },
  "new-folder": { icon: <FolderPlusIcon />, words: "New folder" },
  rename: { icon: <PencilLineIcon />, words: "Rename" },
  duplicate: { icon: <CopyPlusIcon />, words: "Duplicate" },
  copy: { icon: <FilesIcon />, words: "Copy" },
  cut: { icon: <ScissorsIcon />, words: "Cut" },
  paste: { icon: <ClipboardPasteIcon />, words: "Paste" },
  trash: { icon: <Trash2Icon />, words: "Move to Trash" },
}

/** Those of `listed` that `acts` offers, each with its key. */
function ActItems({ acts, listed }: { acts: Acts; listed: readonly Does[] }) {
  const keyLabel = useKeyLabel()
  return listed
    .filter((does) => acts.offers.includes(does))
    .map((does) => {
      const shown = SHOWN[does]
      const words =
        does === "rename" && acts.count > 1
          ? `Rename ${acts.count} items…`
          : shown?.words
      return (
        <DropdownMenuItem
          key={does}
          onClick={() => acts.run(does)}
          variant={does === "trash" ? "destructive" : "default"}
        >
          {shown?.icon}
          {words}
          <DropdownMenuShortcut>{keyLabel(idOf(does))}</DropdownMenuShortcut>
        </DropdownMenuItem>
      )
    })
}

/** The operations of a folder, or of the space under a tree's rows. */
export function MakeItems({ acts }: { acts: Acts }) {
  return <ActItems acts={acts} listed={[...MAKING, "paste"]} />
}

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
  acts,
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
  /** What Files does with the row, or the rows picked with it; none for
   * a list that only shows, as Recent. */
  acts?: Acts
}) {
  const relative = top === null ? null : within(top, whole)
  const { editor, others } = useEditors()
  const keyLabel = useKeyLabel()
  return (
    <>
      <DropdownMenuItem onClick={onOpen}>
        {folder ? <FolderOpenIcon /> : <SquareArrowOutUpRightIcon />}
        Open
        <DropdownMenuShortcut>{keyLabel(idOf("open"))}</DropdownMenuShortcut>
      </DropdownMenuItem>
      {onPeek && (
        <DropdownMenuItem onClick={onPeek}>
          <EyeIcon />
          Quick Look
          <DropdownMenuShortcut>{keyLabel(idOf("peek"))}</DropdownMenuShortcut>
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
      {acts && (
        <>
          <DropdownMenuSeparator />
          <ActItems acts={acts} listed={MAKING} />
          <DropdownMenuSeparator />
          <ActItems acts={acts} listed={CHANGING} />
          <DropdownMenuSeparator />
          <ActItems acts={acts} listed={["trash"]} />
        </>
      )}
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
