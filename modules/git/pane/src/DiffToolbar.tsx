/**
 * The Diff's buttons at the end of its header, as T3 Code's: read again,
 * fold every file or none, stacked or split, the file tree, and the
 * options of how it draws; what can be done to all of it comes first.
 */
import type { ReactNode } from "react"
import { Button } from "@banda/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { cn } from "@banda/ui/lib/utils"
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  Columns2Icon,
  FolderTreeIcon,
  RefreshCwIcon,
  Rows2Icon,
  Settings2Icon,
} from "lucide-react"
import type { View } from "./diff"

export function DiffToolbar({
  view,
  onView,
  onAgain,
  folded,
  onFold,
  children,
}: {
  view: View
  onView: (next: Partial<View>) => void
  onAgain: () => void
  /** Whether every file shown is folded; none when no file is shown. */
  folded: boolean | null
  onFold: (all: boolean) => void
  /** What can be done to all the Diff shows. */
  children?: ReactNode
}) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5">
      {children}
      <Tool label="Read again" onClick={onAgain}>
        <RefreshCwIcon />
      </Tool>
      {folded !== null && (
        <Tool
          label={folded ? "Expand all files" : "Collapse all files"}
          onClick={() => onFold(!folded)}
        >
          {folded ? <ChevronsUpDownIcon /> : <ChevronsDownUpIcon />}
        </Tool>
      )}
      <Tool
        label={view.layout === "split" ? "Stacked" : "Split"}
        onClick={() =>
          onView({ layout: view.layout === "split" ? "stacked" : "split" })
        }
      >
        {view.layout === "split" ? <Rows2Icon /> : <Columns2Icon />}
      </Tool>
      <Tool
        label={view.tree ? "Hide file tree" : "Show file tree"}
        pressed={view.tree}
        onClick={() => onView({ tree: !view.tree })}
      >
        <FolderTreeIcon />
      </Tool>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Diff options"
              title="Diff options"
            />
          }
        >
          <Settings2Icon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-52">
          <DropdownMenuCheckboxItem
            checked={view.wrap}
            onCheckedChange={(wrap) => onView({ wrap })}
          >
            Wrap lines
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={view.ignoreWhitespace}
            onCheckedChange={(ignoreWhitespace) => onView({ ignoreWhitespace })}
          >
            Ignore whitespace
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={view.hideTests}
            onCheckedChange={(hideTests) => onView({ hideTests })}
          >
            Hide tests and mocks
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** A quiet button in the header, its words its label and tooltip. */
function Tool({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string
  pressed?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      className={cn(pressed && "bg-muted text-foreground")}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
