/**
 * What the Person can do to one Item, by its item actions (ADR 0087,
 * decision 12): its App's, found by the first word of its Pane kind, in
 * their order, then the sidebar list's own, Archive. The Thread menu, the
 * Pane menu, the Banda menu's Tab, the title's field and the snooze's
 * picker draw their rows, and run them as any action, by id: none of them
 * knows what an App does to its Items.
 */
import type { ProjectId, ProjectSummary } from "@banda/contract"
import {
  type ItemAction,
  type ItemAt,
  type ItemRow,
  itemArgs,
  itemOf,
} from "@banda/ui/module"
import type { Listed } from "@banda/ui/pane"
import { ArchiveIcon, ArchiveRestoreIcon } from "lucide-react"
import { itemsOf } from "../registry"
import type { StandRow } from "../tiling/PaneMenu"
import type { Shell } from "../window/actions"
import { archivable, archivedNow, toggled } from "./archived"

/**
 * Archive thread, or Unarchive thread (ADR 0069; ADR 0008, decision 4):
 * the sidebar list's own row and key. The Item's host keeps the mark (ADR
 * 0096), so its App's own archive sends it there, in one command, which
 * ends a snoozed Thread's snooze too; archived, the Item is put away once
 * its host took it: every Pane that shows it closes, on any workspace. An
 * Item whose App has none stays as it is.
 */
export const archiving: ItemAction<Shell> = {
  id: "sidebar.archive",
  section: "Threads",
  title: "Archive the Thread you look at, or bring it back",
  keys: [{ code: "KeyS", mod: true }],
  args: itemArgs(),
  group: "other",
  does: "archive",
  offered: ["menu"],
  row: (item, at) =>
    at.archived
      ? { title: "Unarchive thread", icon: ArchiveRestoreIcon }
      : {
          title: "Archive thread",
          icon: ArchiveIcon,
          // Not while it works or asks.
          ...(archivable(item) ? {} : { off: true }),
        },
  run: (shell, args) => {
    const at = itemOf(shell, args)
    if (!at) return
    const { project, listed } = at
    const archived = toggled(shell.items.get(), project, listed.id)
    if (archived === undefined) return
    const owner = itemActionOf(listed, "archive")
    if (owner && owner !== archiving)
      shell.run(owner.id, { project, item: listed.id, archived })
  },
}

/** The item actions of `listed`: its App's, in their order, then the
 * sidebar list's. */
export function itemActionsOf(listed: Listed): readonly ItemAction<Shell>[] {
  return [...itemsOf(listed.pane.kind), archiving]
}

/** The item action of `listed` that does `does`, as the title's field
 * renames by its App's; none where its App has none. */
export function itemActionOf(
  listed: Listed,
  does: NonNullable<ItemAction["does"]>
): ItemAction<Shell> | undefined {
  return itemActionsOf(listed).find((action) => action.does === does)
}

/** How `listed` stands for its rows, as an act reads it outside React:
 * in `project`, archived or not, now. */
function itemAt(listed: Listed, project: ProjectSummary | undefined): ItemAt {
  return { project, now: Date.now(), archived: archivedNow(listed) }
}

/** An item action with its row for one Item. */
export type Shown = { action: ItemAction<Shell>; row: ItemRow }

/** The rows of `listed` that apply `at`, in their order. */
export function rowsOf(listed: Listed, at: ItemAt): Shown[] {
  return itemActionsOf(listed).flatMap((action) => {
    const row = action.row(listed, at)
    return row ? [{ action, row }] : []
  })
}

/** The rows of `listed` offered `where`, the Pane menu or the Banda
 * menu's Tab: those on, as a row that is off is left out there. */
function offeredOf(
  listed: Listed,
  at: ItemAt,
  where: "pane" | "menu"
): Shown[] {
  return rowsOf(listed, at).filter(
    ({ action, row }) => action.offered?.includes(where) && !row.off
  )
}

/** The Pane menu's rows for `listed`, the Item a Pane of `project` shows:
 * those its item actions offer there now, each with what runs it. */
export function paneRowsOf(
  listed: Listed,
  project: ProjectId,
  projects: readonly ProjectSummary[]
): StandRow[] {
  const at = itemAt(
    listed,
    projects.find((one) => one.id === project)
  )
  return offeredOf(listed, at, "pane").map(({ action, row }) => ({
    id: action.id,
    title: row.title,
    icon: row.icon,
    args: { project, item: listed.id },
  }))
}
