/**
 * The current workspace, small, beside its number (ADR 0065, decision 9):
 * a bar for each column, as wide as its share, a Group's in the colour
 * of its Agent's state as its plate takes it, the focused one framed.
 */
import type { Columns } from "@banda/contract/look"
import { cn } from "@banda/ui/lib/utils"
import type { Listed } from "@banda/ui/pane"
import { type GroupState, groupState } from "@banda/ui/components/banda-mark"
import { agentsOf } from "../workspaces/groups"
import { type Entry, share, widthIn, type Workspace } from "../workspaces/model"

/** A column of the map: its share of the screen, its Group, if any, and
 * that Group's state. */
export type MapColumn = {
  id: string
  share: number
  group?: string
  state?: GroupState
  focused: boolean
}

/** The map of `workspace`, by the look's widths and what is listed. */
export function mapOf(
  workspace: Workspace,
  look: Pick<Columns, "presets" | "default" | "alone">,
  listed: (entry: Entry) => Listed | undefined
): MapColumn[] {
  const agents = agentsOf(workspace.columns, listed)
  return workspace.columns.map((column, c) => ({
    id: column.id,
    share: share(widthIn(workspace, column, look)) ?? 0.5,
    ...(column.group !== undefined && {
      group: column.group,
      state: groupState(agents.get(column.group)?.mark),
    }),
    focused: c === workspace.focus,
  }))
}

/** How wide the whole screen is drawn, in rem. */
const SCREEN = 2.5

export function WorkspaceMap({ columns }: { columns: readonly MapColumn[] }) {
  if (columns.length < 2 || !columns.some((c) => c.group !== undefined)) {
    return null
  }
  return (
    <span
      aria-hidden
      className="ml-1.5 flex h-6 items-center gap-px border-l border-border pl-2"
    >
      {columns.map((column, c) => (
        <span
          key={column.id}
          data-map=""
          data-state={column.state}
          className={cn(
            "h-2 shrink-0 rounded-[2px] bg-muted-foreground/35",
            column.group !== undefined && "bg-(--group-color)",
            // A Group's columns stand together; between Groups, a gap.
            c > 0 && columns[c - 1].group !== column.group && "ml-0.5",
            column.focused && "ring-1 ring-foreground/70"
          )}
          style={{ width: `${Math.max(0.25, column.share * SCREEN)}rem` }}
        />
      ))}
    </span>
  )
}
