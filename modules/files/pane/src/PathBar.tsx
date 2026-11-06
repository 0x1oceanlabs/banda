/**
 * A Files Pane's path (ADR 0073, decision 3): crumbs, each a click away;
 * a click on the bar's empty part, or Ctrl+L (⌘L), makes it a field. In
 * the field Tab completes a folder's name from the folder typed, ↵ goes
 * there, and Escape gives the crumbs back. `~` is the home folder.
 */
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { type Engine, type ProjectId } from "@banda/contract"
import type { Entry } from "@banda/contract/files"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { cn } from "@banda/ui/lib/utils"
import {
  ChevronRightIcon,
  FolderIcon,
  HouseIcon,
  SearchIcon,
} from "lucide-react"
import { idOf } from "./keys"
import {
  candidates,
  completed,
  crumbsOf,
  foldCrumbs,
  tilded,
  typedParts,
  untilded,
} from "./where"

/** How many folders the field offers under it. */
const OFFERED = 8

export type PathBarProps = {
  engine: Engine
  project: ProjectId
  /** The folder shown, whole. */
  dir: string
  home: string | null
  editing: boolean
  onEdit: (editing: boolean) => void
  /** Goes to the path typed; what was wrong, if it cannot. */
  onGo: (path: string) => Promise<string | null>
  onFilter: () => void
}

export function PathBar({
  engine,
  project,
  dir,
  home,
  editing,
  onEdit,
  onGo,
  onFilter,
}: PathBarProps) {
  const keyLabel = useKeyLabel()
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b px-1.5">
      {editing ? (
        <PathField
          engine={engine}
          project={project}
          dir={dir}
          home={home}
          onDone={() => onEdit(false)}
          onGo={onGo}
        />
      ) : (
        <Crumbs dir={dir} home={home} onGo={onGo} onEdit={() => onEdit(true)} />
      )}
      {!editing && (
        <button
          type="button"
          aria-label="Filter"
          title={keyLabel(idOf("filter"), "Filter")}
          onClick={onFilter}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/7 hover:text-foreground [&_svg]:size-3.5"
        >
          <SearchIcon />
        </button>
      )}
    </div>
  )
}

/** The crumbs: the last one is where the Pane is. Those that do not fit
 * fold into a `…` after the first. A click on the bar past them makes it
 * a field. */
function Crumbs({
  dir,
  home,
  onGo,
  onEdit,
}: {
  dir: string
  home: string | null
  onGo: (path: string) => void
  onEdit: () => void
}) {
  const bar = useRef<HTMLElement>(null)
  const room = useWidth(bar)
  const keyLabel = useKeyLabel()
  const { shown, folded } = foldCrumbs(crumbsOf(dir, home), room - 24)
  return (
    <nav
      ref={bar}
      aria-label="Path"
      title={keyLabel(idOf("path"), "Type a path")}
      className="flex h-full min-w-0 flex-1 cursor-text items-center overflow-hidden"
      onClick={(event) => {
        if (event.target === event.currentTarget) onEdit()
      }}
    >
      {shown.map((crumb, n) => (
        <span
          key={crumb === "folded" ? "…" : crumb.path}
          className="flex min-w-0 shrink items-center"
        >
          {n > 0 && (
            <ChevronRightIcon
              aria-hidden
              className="size-3 shrink-0 text-muted-foreground/60"
            />
          )}
          {crumb === "folded" ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<CrumbButton label="The folders between" />}
              >
                …
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-40">
                {folded.map((one) => (
                  <DropdownMenuItem
                    key={one.path}
                    onClick={() => onGo(one.path)}
                  >
                    <FolderIcon />
                    {one.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <CrumbButton
              label={crumb.name === "~" ? "Home" : crumb.name}
              last={n === shown.length - 1}
              onClick={() => onGo(crumb.path)}
            >
              {crumb.name === "~" ? (
                <HouseIcon className="size-3.5" />
              ) : (
                <span className="truncate">{crumb.name}</span>
              )}
            </CrumbButton>
          )}
        </span>
      ))}
      <span className="h-full min-w-6 flex-1" onClick={onEdit} />
    </nav>
  )
}

/** How wide `of` is, in px, as it is resized; a wide guess till it is
 * measured. */
function useWidth(of: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(Infinity)
  useEffect(() => {
    const own = of.current
    if (!own) return
    const seen = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry?.contentRect.width ?? Infinity))
    )
    seen.observe(own)
    return () => seen.disconnect()
  }, [of])
  return width
}

/** One crumb: quiet, the last one, where the Pane is, in the text's
 * colour. */
function CrumbButton({
  label,
  last = false,
  children,
  ...rest
}: {
  label: string
  last?: boolean
  children?: ReactNode
} & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={last ? "location" : undefined}
      className={cn(
        "flex h-6 min-w-0 shrink items-center rounded-md px-1.5 text-xs text-muted-foreground hover:bg-foreground/7 hover:text-foreground",
        last && "shrink-0 text-foreground"
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/** The path as a field, with the folders it may go on to. */
function PathField({
  engine,
  project,
  dir,
  home,
  onDone,
  onGo,
}: {
  engine: Engine
  project: ProjectId
  dir: string
  home: string | null
  onDone: () => void
  onGo: (path: string) => Promise<string | null>
}) {
  const field = useRef<HTMLInputElement>(null)
  const [typed, setTyped] = useState(() => {
    const shown = tilded(dir, home)
    return shown.endsWith("/") ? shown : `${shown}/`
  })
  const [wrong, setWrong] = useState<string | null>(null)
  const [picked, setPicked] = useState(0)
  // The folders in the folder typed whose names begin as typed.
  const { folder, start } = typedParts(typed)
  const [offered, setOffered] = useState<{
    folder: string
    entries: readonly Entry[]
  }>()
  const listOf = useCallback(
    (typedFolder: string): Promise<readonly Entry[]> =>
      engine
        .call(
          "files.list",
          { dir: untilded(typedFolder || ".", home, dir) },
          { project }
        )
        .then(
          (found) => found.entries,
          () => []
        ),
    [engine, project, dir, home]
  )
  useEffect(() => {
    let gone = false
    void listOf(folder).then(
      (entries) => gone || setOffered({ folder, entries })
    )
    return () => {
      gone = true
    }
  }, [listOf, folder])
  const all =
    offered?.folder === folder ? candidates(offered.entries, start) : []
  const names = all.slice(0, OFFERED)
  const shown = start === "" && !typed.endsWith("/") ? [] : names

  // The caret at its end, so a name typed goes on from the folder shown.
  useEffect(() => {
    const input = field.current
    input?.focus()
    input?.setSelectionRange(input.value.length, input.value.length)
  }, [])

  const go = (path: string) => {
    void onGo(path).then((why) => {
      if (why) setWrong(why)
      else onDone()
    })
  }

  return (
    <div className="relative flex min-w-0 flex-1">
      <input
        ref={field}
        aria-label="Path"
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-autocomplete="list"
        spellCheck={false}
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value)
          setWrong(null)
          setPicked(0)
        }}
        onBlur={onDone}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            event.stopPropagation()
            onDone()
          } else if (event.key === "Tab" && !event.shiftKey) {
            event.preventDefault()
            // The folder's names, as soon as they are in.
            const listed =
              offered?.folder === folder
                ? Promise.resolve(offered.entries)
                : listOf(folder)
            void listed.then((entries) => {
              const fits = candidates(entries, start)
              const pick = fits[picked]
              setTyped(
                pick && (fits.length === 1 || completed(typed, fits) === typed)
                  ? `${folder}${pick}/`
                  : completed(typed, fits)
              )
              setPicked(0)
            })
          } else if (event.key === "ArrowDown" && shown.length > 0) {
            event.preventDefault()
            setPicked((n) => (n + 1) % shown.length)
          } else if (event.key === "ArrowUp" && shown.length > 0) {
            event.preventDefault()
            setPicked((n) => (n - 1 + shown.length) % shown.length)
          } else if (event.key === "Enter") {
            event.preventDefault()
            go(untilded(typed, home, dir))
          }
        }}
        className={cn(
          "h-6 min-w-0 flex-1 rounded-md border bg-transparent px-2 font-mono text-xs outline-none focus:border-ring",
          wrong && "border-destructive/60"
        )}
      />
      {(shown.length > 0 || wrong) && (
        <div
          role="listbox"
          aria-label="Folders"
          className="absolute top-7 right-0 left-0 z-20 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
          onMouseDown={(event) => event.preventDefault()}
        >
          {wrong ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">{wrong}</p>
          ) : (
            shown.map((name, n) => (
              <div
                key={name}
                role="option"
                aria-selected={n === picked}
                onClick={() => {
                  setTyped(`${folder}${name}/`)
                  field.current?.focus()
                }}
                className={cn(
                  "flex h-6 cursor-default items-center gap-2 rounded-md px-2 font-mono text-xs",
                  n === picked && "bg-foreground/8"
                )}
              >
                <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{name}</span>
                {n === picked && (
                  <span className="ml-auto font-sans text-[10.5px] text-muted-foreground">
                    Tab
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
