/**
 * A card's menu (ADR 0098, decision 14): one menu, by where its Thread
 * stands, which a right click on the card opens where the pointer is, and
 * Shift+F10 or the Menu key at the card picked (`openCardMenu`). Its rows
 * are the card's acts, by the same ways as its buttons and its keys, each
 * with the sidebar's key in force: Later and Archive keep what Ctrl+Z
 * takes back, and Archive on a card that asks says why in a toast, as S
 * does. Delete…, in the Archive alone, asks first (`DeleteDialog`). What
 * a Thread's App does, it does by its item actions (ADR 0087, decision
 * 12), found by what each does.
 */
import {
  createContext,
  Fragment,
  type ReactElement,
  type RefObject,
  useContext,
  useRef,
  useState,
} from "react"
import type { ProjectSummary } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  useAfterMenu,
} from "@banda/ui/components/context-menu"
import {
  AlertDialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@banda/ui/components/dropdown-menu"
import { MachineMark } from "@banda/ui/components/machine-icon"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { type Machine, useMachines, useRun } from "@banda/core/react"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { projectLabel } from "@banda/ui/lib/projects"
import type { Listed } from "@banda/ui/pane"
import { mayArchive, type Stand } from "@banda/ui/status"
import {
  CircleDotIcon,
  CircleIcon,
  Columns2Icon,
  CopyIcon,
  FolderInputIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GitForkIcon,
  LoaderIcon,
  type LucideIcon,
  PencilIcon,
  SquareArrowOutUpRightIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react"
import { MenuRow, useMenuProjects } from "../titles/ThreadMenu"
import { actsOf } from "./acts"
import type { Row } from "./rows"
import { ACT_LOOK } from "./CardView"
import { refused } from "./refusals"
import { type Does, keyId } from "./keys"
import { useOpen } from "./open"
import { useActs, useDoing } from "./useActs"
import { HoldingContext, useHoldWhile } from "./useHold"

/** A row of the card's menu, by what it does. */
export type Entry =
  | "open"
  | "beside"
  | "archive"
  | "unarchive"
  | "later"
  | "done"
  | "wake"
  | "unread"
  | "read"
  | "stop"
  | "rename"
  | "fork"
  | "move"
  | "make"
  | "copy"
  | "folder"
  | "delete"

/**
 * The card's menu by where its Thread stands (ADR 0098, decision 14), in
 * groups a line apart: Open, Open beside; Archive, Later…, Mark as unread
 * or read; Rename…, Fork, Move to Project; Copy as Markdown, Show folder.
 * In the Archive, Unarchive in Archive's place, and Delete… last; in
 * Later, Wake now, then Later… for another time; at work, Later…, Later —
 * when done and Stop. One that asks has no Mark as unread, as `U` leaves a
 * question until it is answered, and one at work or that asks neither
 * forks nor moves, which its host refuses then; Move to Project only
 * where `moves`, another Project to go to, on this machine or another
 * (ADR 0116, decision 1); one in No Project (`scratch`)
 * has Make a Project from it… (ADR 0046), whatever it does. Pure, so
 * plain tests cover it.
 */
export function entriesOf(
  stand: Stand,
  listed: Pick<Listed, "mark" | "seen">,
  { moves, scratch }: { moves: boolean; scratch?: boolean }
): Entry[][] {
  const unread: Entry[] =
    listed.mark === "asking" || listed.seen === undefined
      ? []
      : [listed.seen ? "unread" : "read"]
  const acts: Entry[] =
    stand === "archived"
      ? ["unarchive"]
      : stand === "later"
        ? ["wake", "later"]
        : stand === "working"
          ? ["later", "done", "stop"]
          : ["archive", "later", ...unread]
  const naming: Entry[] = [
    "rename",
    ...(mayArchive(listed) ? ["fork" as const] : []),
    ...(mayArchive(listed) && moves ? ["move" as const] : []),
    ...(scratch ? ["make" as const] : []),
  ]
  const groups: Entry[][] = [
    ["open", "beside"],
    acts,
    naming,
    ["copy", "folder"],
  ]
  return stand === "archived" ? [...groups, ["delete"]] : groups
}

/** Each row's words, icon and the sidebar's key that does it on the pick,
 * if one does. */
const LOOK: Readonly<
  Record<Entry, { title: string; icon: LucideIcon; key?: Does }>
> = {
  open: { title: "Open", icon: SquareArrowOutUpRightIcon, key: "open" },
  beside: { title: "Open beside", icon: Columns2Icon, key: "beside" },
  archive: { title: "Archive", icon: ACT_LOOK.archive.icon, key: "archive" },
  unarchive: {
    title: "Unarchive",
    icon: ACT_LOOK.unarchive.icon,
    key: "archive",
  },
  later: { title: "Later…", icon: ACT_LOOK.later.icon, key: "later" },
  done: { title: "Later — when done", icon: LoaderIcon },
  wake: { title: "Wake now", icon: ACT_LOOK.wake.icon },
  unread: { title: "Mark as unread", icon: CircleDotIcon, key: "unread" },
  read: { title: "Mark as read", icon: CircleIcon, key: "unread" },
  stop: { title: "Stop", icon: SquareIcon },
  rename: { title: "Rename…", icon: PencilIcon, key: "rename" },
  fork: { title: "Fork", icon: GitForkIcon },
  move: { title: "Move to Project", icon: FolderInputIcon },
  make: { title: "Make a Project from it…", icon: FolderPlusIcon },
  copy: { title: "Copy as Markdown", icon: CopyIcon },
  folder: { title: "Show folder", icon: FolderOpenIcon },
  delete: { title: "Delete…", icon: Trash2Icon, key: "delete" },
}

/** The Projects a Thread of `from` may move to: this machine's others,
 * neither another Thread's No Project nor one whose folder is gone. */
function movesTo(
  projects: readonly ProjectSummary[],
  from: string
): ProjectSummary[] {
  return projects.filter(
    (one) => one.id !== from && !one.scratch && !one.missing && !one.archived
  )
}

/** Another machine a Thread may move to (ADR 0116, decision 1): its name
 * and icon, whether it is away, and its Projects, none while it is. */
export type There = Pick<Machine, "host" | "named" | "projects"> & {
  away: boolean
}

/** The other machines the Window reaches, as "Move to Project" lists
 * them under this machine's Projects: each under its name, an away one
 * with no Projects. Pure, so a plain test covers it. */
export function machinesTo(machines: readonly Machine[] | undefined): There[] {
  return (machines ?? [])
    .filter((machine) => machine.host !== undefined)
    .map(({ host, named, state, projects }) => ({
      host,
      named,
      away: state === "away",
      projects: state === "away" ? [] : projects,
    }))
}

/**
 * Asks whether to delete a card's Thread, the one picked by `Delete` or
 * the one whose menu's Delete… was chosen; none takes the question away.
 * The sidebar's keys keep it, as the list's own popup.
 */
export const AskDelete = createContext<(row: Row | undefined) => void>(
  () => undefined
)

/** The card Delete asks about, and what asks or stops asking. */
export type Deleting = { row?: Row; ask: (row: Row | undefined) => void }

/**
 * The card `children` with its menu around it: a right click opens it
 * where the pointer is, and `openCardMenu` at the card. Open, it holds
 * the list still (ADR 0098, decision 6).
 */
export function CardMenu({
  row,
  children,
}: {
  row: Row
  children: ReactElement
}) {
  const [shown, setShown] = useState(false)
  useHoldWhile(shown)
  const card = useRef<HTMLDivElement>(null)
  return (
    <ContextMenu onOpenChange={setShown}>
      <ContextMenuTrigger ref={card}>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label="Thread menu" className="min-w-60">
        <Entries row={row} card={card} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** The menu's rows for `row`, worked out only while it is open; `card`
 * is where the Later picker opens. */
function Entries({
  row,
  card,
}: {
  row: Row
  card: RefObject<HTMLDivElement | null>
}) {
  const keyFor = useKeyLabel()
  const later = useAfterMenu()
  const open = useOpen()
  const run = useRun()
  const doing = useDoing()
  const holding = useContext(HoldingContext)
  const actOn = useActs(holding)
  const ask = useContext(AskDelete)
  const projects = movesTo(useMenuProjects(), row.project.id)
  const there = machinesTo(useMachines())
  const { listed } = row
  const project = row.project.id
  // As the Person's last input in the list was: a right click, or a key.
  const on = () => ({ card: card.current ?? document.documentElement })
  // What each row does: a Pane opens, the card goes where the Person put
  // it, or its App does it.
  const runs: Record<Exclude<Entry, "move">, () => void> = {
    open: () => open("pane.pick", { project, pane: listed.pane }),
    beside: () => open("pane.beside", { project, pane: listed.pane }),
    archive: () =>
      actsOf(row.stand, listed).includes("archive")
        ? actOn(row, "archive", on())
        : refused(row, keyFor(keyId("later"))),
    unarchive: () => actOn(row, "unarchive", on()),
    // The picker takes the focus once the menu has gone.
    later: () => later(() => actOn(row, "later", on())),
    done: () => actOn(row, "later", { ...on(), done: true }),
    wake: () => actOn(row, "wake", on()),
    unread: () => actOn(row, "unread", on()),
    read: () => actOn(row, "unread", on()),
    stop: () => doing(row, "stop"),
    // Its field takes the focus once the menu has gone.
    rename: () => later(() => doing(row, "rename", { from: "row" })),
    fork: () => doing(row, "fork"),
    // Its dialog takes the focus once the menu has gone.
    make: () => later(() => doing(row, "make-project")),
    copy: () => doing(row, "copy"),
    folder: () => run("file.outside", { file: row.project.folder }),
    // The dialog takes the focus once the menu has gone.
    delete: () => later(() => ask(row)),
  }
  const groups = entriesOf(row.stand, listed, {
    moves: projects.length > 0 || there.length > 0,
    scratch: row.project.scratch,
  })
  return groups.map((group, at) => (
    <Fragment key={group.join()}>
      {at > 0 && <DropdownMenuSeparator />}
      {group.map((entry) => {
        const { title, icon: Icon, key } = LOOK[entry]
        if (entry === "move")
          return (
            <DropdownMenuSub key={entry}>
              <DropdownMenuSubTrigger>
                <Icon />
                {title}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-w-72 min-w-48">
                {projects.map((to) => (
                  <DropdownMenuItem
                    key={to.id}
                    onClick={() => {
                      holding?.act(row)
                      doing(row, "move", { to: to.id })
                    }}
                  >
                    <ProjectSign project={to} size={14} />
                    <span className="truncate">{projectLabel(to)}</span>
                  </DropdownMenuItem>
                ))}
                {/* Each other machine under its name (ADR 0116, decision
                    1): its Project opens Move Thread, which says first
                    what goes and what stays. */}
                {there.map((machine, at) => (
                  <DropdownMenuGroup key={machine.host}>
                    {(at > 0 || projects.length > 0) && (
                      <DropdownMenuSeparator />
                    )}
                    <DropdownMenuLabel className="flex items-center">
                      {machine.named && (
                        <MachineMark named={machine.named} form="full" />
                      )}
                      {machine.away && (
                        <span className="ml-auto pl-4">away</span>
                      )}
                    </DropdownMenuLabel>
                    {machine.projects.map((to) => (
                      <DropdownMenuItem
                        key={to.id}
                        // Its dialog takes the focus once the menu has gone.
                        onClick={() =>
                          later(() => doing(row, "move", { to: to.id }))
                        }
                      >
                        <ProjectSign project={to} size={14} />
                        <span className="truncate">{projectLabel(to)}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )
        return (
          <MenuRow
            key={entry}
            icon={Icon}
            title={title}
            shortcut={key && keyFor(keyId(key))}
            danger={entry === "delete"}
            onClick={runs[entry]}
          />
        )
      })}
    </Fragment>
  ))
}

/**
 * Opens the menu of `card`, as Shift+F10 and the Menu key do on the card
 * picked: at the card, under its first line's start, as a right click
 * there would, so a menu opened from the keys stands by the card it is
 * of. A card with no menu, another machine's or one being named, opens
 * none.
 */
export function openCardMenu(card: Element): void {
  const box = card.getBoundingClientRect()
  card.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: box.left + 8,
      clientY: box.bottom,
    })
  )
}

/**
 * Asks whether to delete `row`'s Thread for good (ADR 0098, decision 14):
 * "Delete “Title”?", Cancel the default. Delete asks its App to, on its
 * host; the card leaves the Archive at once, as the Person's own act.
 * While it asks, the list holds still; closed, the focus goes back where
 * it was, the list. It stands outside the list, so the pointer on it is
 * not on the list, and the list lets go as the dialog closes.
 */
export function DeleteDialog({
  deleting: { row, ask },
}: {
  deleting: Deleting
}) {
  const doing = useDoing()
  const holding = useContext(HoldingContext)
  useHoldWhile(row !== undefined)
  // Its words stay as it fades out.
  const [said, setSaid] = useState(row)
  if (row && row !== said) setSaid(row)
  return (
    <AlertDialog
      open={row !== undefined}
      onOpenChange={(open) => {
        if (!open) ask(undefined)
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete “{said?.listed.title}”?</DialogTitle>
          <DialogDescription>
            Its messages and its worktree go. This can't be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            autoFocus
            onClick={() => ask(undefined)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              ask(undefined)
              if (!row) return
              holding?.act(row)
              doing(row, "delete")
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </AlertDialog>
  )
}
