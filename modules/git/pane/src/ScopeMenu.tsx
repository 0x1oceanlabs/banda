/**
 * The Diff's menus in its header, as T3 Code's: the scope, with the
 * Thread's turns and the branch's commits, and the base Changes compare
 * against, each list read as its menu opens.
 */
import { useCallback, useMemo, useState, type ReactNode } from "react"
import type { Engine, SpaceId } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { useRead, type Read } from "@banda/ui/hooks/use-read"
import { cn } from "@banda/ui/lib/utils"
import { ChevronDownIcon } from "lucide-react"
import { CHANGES, labelOf, type Scope } from "./scope"

/** Reads a list each time its menu opens; `onOpenChange` goes on the menu. */
function useReadOnOpen<T>(read: () => Promise<T>) {
  const [open, setOpen] = useState(false)
  const reading = useMemo(() => (open ? read : null), [open, read])
  return { list: useRead(reading), onOpenChange: setOpen }
}

/** A list read for a menu, or why it is not there yet. */
function Listed<T>({
  read,
  none,
  children,
}: {
  read: Read<T[]>
  none: string
  children: (items: T[]) => ReactNode
}) {
  if (read.state === "loading")
    return <DropdownMenuLabel>Reading…</DropdownMenuLabel>
  if (read.state === "refused")
    return <DropdownMenuLabel>{read.refusal.message}</DropdownMenuLabel>
  if (read.value.length === 0)
    return <DropdownMenuLabel>{none}</DropdownMenuLabel>
  return children(read.value)
}

/** The scope menu, as T3 Code's: Changes, Uncommitted, and the Codex
 * app's Unstaged and Staged, and the branch's commits in a submenu, read
 * as it opens. */
export function ScopeMenu({
  engine,
  space,
  scope,
  thread,
  onChange,
}: {
  engine: Engine
  space: SpaceId
  scope: Scope
  /** The Thread whose turns it offers; none offers none. */
  thread: string | null
  onChange: (scope: Scope) => void
}) {
  const [open, setOpen] = useState(false)
  const base = scope.kind === "changes" ? scope.base : null
  const commits = useRead(
    useMemo(
      () =>
        open
          ? () =>
              engine.call("git.commits", base === null ? {} : { base }, {
                space,
              })
          : null,
      [open, engine, space, base]
    )
  )
  const turns = useRead(
    useMemo(
      () =>
        open && thread !== null
          ? () =>
              engine
                .call("agents.changes", { thread }, { space })
                .then((changes) => changes.turns)
          : null,
      [open, engine, space, thread]
    )
  )
  const value =
    scope.kind === "commit"
      ? `commit:${scope.sha}`
      : scope.kind === "turn"
        ? `turn:${scope.turn}`
        : scope.kind
  return (
    <DropdownMenu onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 font-medium"
            aria-label="Scope"
          />
        }
      >
        <span className="truncate">{labelOf(scope)}</span>
        <ChevronDownIcon
          data-icon="inline-end"
          className="text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-56">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (next === "changes") onChange(CHANGES)
            else if (
              next === "uncommitted" ||
              next === "unstaged" ||
              next === "staged"
            )
              onChange({ kind: next })
          }}
        >
          <Choice
            value="changes"
            name="Changes"
            about="This branch against its base"
          />
          <Choice
            value="uncommitted"
            name="Uncommitted"
            about="Everything since the last commit"
          />
          <Choice
            value="unstaged"
            name="Unstaged"
            about="What is not staged yet"
          />
          <Choice
            value="staged"
            name="Staged"
            about="What a commit would take"
          />
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {thread !== null && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Turns</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-96 w-80 overflow-y-auto">
              <DropdownMenuGroup>
                <Listed read={turns} none="No turn changed files">
                  {(list) =>
                    list.map((turn) => (
                      <DropdownMenuItem
                        key={turn.turn}
                        onClick={() =>
                          onChange({
                            kind: "turn",
                            thread,
                            turn: turn.turn,
                            title: turn.said,
                          })
                        }
                        className={cn(
                          value === `turn:${turn.turn}` && "bg-accent"
                        )}
                      >
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {turn.n}
                        </span>
                        <span className="truncate">{turn.said || "Turn"}</span>
                      </DropdownMenuItem>
                    ))
                  }
                </Listed>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Commits</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-96 w-80 overflow-y-auto">
            <DropdownMenuGroup>
              <Listed read={commits} none="No commits on this branch">
                {(list) =>
                  list.map((commit) => (
                    <DropdownMenuItem
                      key={commit.sha}
                      onClick={() =>
                        onChange({
                          kind: "commit",
                          sha: commit.sha,
                          subject: commit.subject,
                        })
                      }
                      className={cn(
                        value === `commit:${commit.sha}` && "bg-accent"
                      )}
                    >
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {commit.short}
                      </span>
                      <span className="truncate">{commit.subject}</span>
                    </DropdownMenuItem>
                  ))
                }
              </Listed>
            </DropdownMenuGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A radio choice of a menu: its name, and what it means under it. */
function Choice({
  value,
  name,
  about,
}: {
  value: string
  name: string
  about: string
}) {
  return (
    <DropdownMenuRadioItem value={value} closeOnClick>
      <span className="flex flex-col">
        <span>{name}</span>
        <span className="text-xs text-muted-foreground">{about}</span>
      </span>
    </DropdownMenuRadioItem>
  )
}

/** What Changes compares against: "Automatic", the default branch where
 * the branch left it, or a branch chosen, read as the menu opens. */
export function BaseMenu({
  engine,
  space,
  base,
  found,
  onChange,
}: {
  engine: Engine
  space: SpaceId
  base: string | null
  found: string
  onChange: (base: string | null) => void
}) {
  const branches = useReadOnOpen(
    useCallback(() => engine.call("git.refs", {}, { space }), [engine, space])
  )
  return (
    <DropdownMenu onOpenChange={branches.onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 font-normal text-muted-foreground"
            aria-label="Base"
          />
        }
      >
        <span className="truncate">vs {found}</span>
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-96 w-auto min-w-56 overflow-y-auto"
      >
        <DropdownMenuRadioGroup
          value={base ?? ""}
          onValueChange={(next) => onChange(next === "" ? null : String(next))}
        >
          <Choice
            value=""
            name="Automatic"
            about="Where it left the default branch"
          />
          <Listed read={branches.list} none="No other branches">
            {(list) =>
              list
                .filter((branch) => !branch.current)
                .map((branch) => (
                  <DropdownMenuRadioItem
                    key={branch.name}
                    value={branch.name}
                    closeOnClick
                  >
                    <span className="truncate font-mono text-xs">
                      {branch.name}
                    </span>
                  </DropdownMenuRadioItem>
                ))
            }
          </Listed>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
