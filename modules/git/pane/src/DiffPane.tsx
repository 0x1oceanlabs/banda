import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { Engine, SpaceId } from "@banda/contract"
import type { Diff, DiffAsk } from "@banda/contract/git"
import { Button } from "@banda/ui/components/button"
import {
  CodeDiff,
  filesOf,
  keyOf,
  pathOf,
  type CodeViewHandle,
  type FileDiffMetadata,
} from "@banda/ui/components/code-diff"
import { DiffCounts } from "@banda/ui/components/diff"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@banda/ui/components/empty"
import { ChangedFiles, type TreeFile } from "@banda/ui/components/file-tree"
import { PaneHeader } from "@banda/ui/components/pane-header"
import { Spinner } from "@banda/ui/components/spinner"
import { useInFront } from "@banda/ui/hooks/use-in-front"
import { READ_AGAIN, useLive } from "@banda/ui/hooks/use-live"
import { useRead, type Read } from "@banda/ui/hooks/use-read"
import { cn } from "@banda/ui/lib/utils"
import { definePane, type PaneProps } from "@banda/ui/pane"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  Columns2Icon,
  FileDiffIcon,
  FolderTreeIcon,
  RefreshCwIcon,
  Rows2Icon,
  Settings2Icon,
} from "lucide-react"
import { AT_ONCE, asked, VIEW, viewOf, type View } from "./diff"
import { CHANGES, changeOf, isTest, labelOf, type Scope } from "./scope"

/**
 * What changed in the Space's folder, as T3 Code's Diff shows it (ADR
 * 0034, decision 2): one Pane, its scope chosen from a menu in its header,
 * files drawn by `@pierre/diffs` beside a tree of them. It reads again as
 * an Agent's turn ends, as the window comes back, and on its button.
 */
export type DiffArgs = {
  scope: Scope
  view: View
}

export const diffPane = definePane<DiffArgs>({
  kind: "git.diff",
  title: () => "Diff",
  detail: (args) => labelOf(args.scope),
  icon: FileDiffIcon,
  letter: "D",
  start: { scope: CHANGES, view: VIEW },
  header: false,
  // One Diff per Space: another scope is the same Pane.
  identity: () => "diff",
  Pane: DiffPane,
})

/** What makes the Diff read again: an Agent's turn ending. */
const TURNS = { module: "agents", kinds: ["turn.ended"] }

function DiffPane({ engine, space, args, update, close }: PaneProps<DiffArgs>) {
  const scope = args.scope
  const view = viewOf(args.view)
  const set = (next: Partial<View>) =>
    update({ ...args, view: { ...view, ...next } })

  // It reads again on its button and as the window comes back, keeping
  // what it shows until the answer.
  const [round, setRound] = useState(0)
  const again = () => setRound((n) => n + 1)
  const front = useInFront()
  const [wasFront, setWasFront] = useState(front)
  if (front !== wasFront) {
    setWasFront(front)
    if (front) again()
  }

  // The question's words decide: the same words ask the same.
  const words = JSON.stringify({
    scope: asked(scope),
    ignore_whitespace: view.ignoreWhitespace,
  })
  const ask = useMemo(() => JSON.parse(words) as DiffAsk, [words])
  const source = useMemo(
    () => ({
      read: () => engine.call("git.diff", ask, { space }),
      filter: TURNS,
      apply: () => READ_AGAIN,
    }),
    [engine, space, ask]
  )
  const live = useLive(engine, space, source, round)
  const diff = live.state === "ready" ? live.view : undefined

  const files = useFiles(engine, space, ask, words, diff)
  // The files shown: tests and mocks left out when they are hidden.
  const visible = useMemo(
    () =>
      (diff?.files ?? []).filter(
        (file) => !view.hideTests || !isTest(file.path)
      ),
    [diff, view.hideTests]
  )
  const shown = useMemo(
    () =>
      visible.flatMap((file) => {
        const drawn = files.byPath.get(file.path)
        return drawn ? [drawn] : []
      }),
    [visible, files.byPath]
  )
  const tree = useMemo<TreeFile[]>(
    () =>
      visible.map((file) => {
        const drawn = files.byPath.get(file.path)
        return {
          path: file.path,
          status: drawn
            ? changeOf(drawn.type)
            : file.old_path
              ? "renamed"
              : "modified",
        }
      }),
    [visible, files.byPath]
  )

  // Files open folded, as T3 Code opens them, but for those flipped since.
  const [folds, setFolds] = useState<{
    all: boolean
    flipped: ReadonlySet<string>
  }>({ all: true, flipped: new Set() })
  const folded = useMemo(
    () =>
      new Set(
        shown.map(keyOf).filter((key) => folds.all !== folds.flipped.has(key))
      ),
    [shown, folds]
  )
  const flip = (key: string) =>
    setFolds(({ all, flipped }) => {
      const next = new Set(flipped)
      if (!next.delete(key)) next.add(key)
      return { all, flipped: next }
    })
  const allFolded = shown.length > 0 && folded.size === shown.length

  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const reveal = (path: string) => {
    setSelected(path)
    const file = files.byPath.get(path)
    if (!file) {
      files.load([path])
      return
    }
    const key = keyOf(file)
    if (folded.has(key)) flip(key)
    // The view scrolls once the file is drawn open.
    requestAnimationFrame(() =>
      viewer.current?.scrollTo({ type: "item", id: key, align: "start" })
    )
  }

  const added = diff?.files.reduce((sum, file) => sum + file.added, 0) ?? 0
  const removed = diff?.files.reduce((sum, file) => sum + file.removed, 0) ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader title="Diff" onClose={close}>
        <ScopeMenu
          engine={engine}
          space={space}
          scope={scope}
          onChange={(next) => update({ ...args, scope: next })}
        />
        {scope.kind === "changes" && diff?.base && (
          <BaseMenu
            engine={engine}
            space={space}
            base={scope.base}
            found={diff.base.name}
            onChange={(base) =>
              update({ ...args, scope: { kind: "changes", base } })
            }
          />
        )}
        <DiffCounts added={added} removed={removed} />
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Tool label="Read again" onClick={again}>
            <RefreshCwIcon />
          </Tool>
          {shown.length > 0 && (
            <Tool
              label={allFolded ? "Expand all files" : "Collapse all files"}
              onClick={() => setFolds({ all: !allFolded, flipped: new Set() })}
            >
              {allFolded ? <ChevronsUpDownIcon /> : <ChevronsDownUpIcon />}
            </Tool>
          )}
          <Tool
            label={view.layout === "split" ? "Stacked" : "Split"}
            onClick={() =>
              set({ layout: view.layout === "split" ? "stacked" : "split" })
            }
          >
            {view.layout === "split" ? <Rows2Icon /> : <Columns2Icon />}
          </Tool>
          <Tool
            label={view.tree ? "Hide file tree" : "Show file tree"}
            pressed={view.tree}
            onClick={() => set({ tree: !view.tree })}
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
                onCheckedChange={(wrap) => set({ wrap })}
              >
                Wrap lines
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={view.ignoreWhitespace}
                onCheckedChange={(ignoreWhitespace) =>
                  set({ ignoreWhitespace })
                }
              >
                Ignore whitespace
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={view.hideTests}
                onCheckedChange={(hideTests) => set({ hideTests })}
              >
                Hide tests and mocks
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </PaneHeader>
      {live.state === "refused" ? (
        <Blank title="No diff">{live.refusal.message}</Blank>
      ) : !diff ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : diff.files.length === 0 ? (
        <Blank title="No changes">{EMPTY[scope.kind]}</Blank>
      ) : visible.length === 0 ? (
        <Blank title="Only tests changed">Tests and mocks are hidden.</Blank>
      ) : (
        <div className="flex min-h-0 flex-1">
          {view.tree && tree.length > 1 && (
            <aside className="flex w-56 shrink-0 flex-col border-r">
              <div className="flex h-8 shrink-0 items-center px-3 text-xs">
                <span className="font-medium">Files</span>
                <span className="ml-auto text-muted-foreground tabular-nums">
                  {tree.length}
                </span>
              </div>
              <div className="min-h-0 flex-1">
                <ChangedFiles
                  files={tree}
                  selected={selected}
                  onSelect={reveal}
                />
              </div>
            </aside>
          )}
          <CodeDiff
            viewer={viewer}
            className="min-h-0 min-w-0 flex-1"
            files={shown}
            folded={folded}
            layout={view.layout}
            wrap={view.wrap}
            load={files.whole}
            prefix={(key) => (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={folded.has(key) ? "Expand" : "Collapse"}
                onClick={() => flip(key)}
              >
                {folded.has(key) ? <ChevronRightIcon /> : <ChevronDownIcon />}
              </Button>
            )}
            {...(files.missing.length > 0
              ? {
                  footer: () => (
                    <More
                      key={files.missing[0]}
                      left={files.missing.length}
                      loading={files.loading}
                      onSeen={() => files.load(files.missing.slice(0, AT_ONCE))}
                    />
                  ),
                }
              : {})}
          />
        </div>
      )}
    </div>
  )
}

/** The Pane's words where it has nothing to draw. */
function Blank({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

const EMPTY: Record<Scope["kind"], string> = {
  changes: "This branch changes nothing its base does not have.",
  uncommitted: "Nothing changed since the last commit.",
  staged: "Nothing is staged.",
  commit: "This commit changes no files.",
}

/** A short number for a patch, so highlighting kept for one is not used
 * for another. */
function hashOf(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i++)
    hash = (Math.imul(hash, 33) ^ text.charCodeAt(i)) | 0
  return (hash >>> 0).toString(36)
}

/**
 * The files of a diff as the view draws them, by path: those its patch
 * holds, and those it left out, loaded by name a few at a time as they
 * come into view. A diff read again with the same patch keeps them all, so
 * nothing is drawn again. `whole` reads a file's both sides for its context
 * to expand.
 */
function useFiles(
  engine: Engine,
  space: SpaceId,
  ask: DiffAsk,
  words: string,
  diff: Diff | undefined
) {
  const patch = diff?.patch ?? ""
  const basis = `${words}:${hashOf(patch)}`
  const inPatch = useMemo(() => filesOf(patch, basis), [patch, basis])
  // What loaded by name belongs to one patch.
  const [loaded, setLoaded] = useState<{
    basis: string
    files: FileDiffMetadata[]
  }>({ basis, files: [] })
  const [loading, setLoading] = useState(false)
  const byPath = useMemo(() => {
    const extra = loaded.basis === basis ? loaded.files : []
    return new Map([...inPatch, ...extra].map((file) => [pathOf(file), file]))
  }, [inPatch, loaded, basis])
  const missing = useMemo(
    () =>
      (diff?.files ?? [])
        .filter((file) => !byPath.has(file.path))
        .map((file) => file.path),
    [diff, byPath]
  )

  const load = (paths: string[]) => {
    if (loading || paths.length === 0) return
    setLoading(true)
    engine
      .call("git.diff", { ...ask, files: paths }, { space })
      .then((more) => {
        const files = filesOf(more.patch, `${basis}:${paths.join("\0")}`)
        setLoaded((was) => ({
          basis,
          files: [...(was.basis === basis ? was.files : []), ...files],
        }))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  const whole = useCallback(
    async (file: FileDiffMetadata) => {
      const contents = await engine.call(
        "git.contents",
        {
          scope: ask.scope,
          path: pathOf(file),
          ...(file.prevName ? { old_path: file.prevName } : {}),
        },
        { space }
      )
      if (contents.too_large)
        throw new Error("The file is too large to expand.")
      return {
        oldFile: {
          name: file.prevName ?? pathOf(file),
          contents: contents.old ?? "",
        },
        newFile: { name: pathOf(file), contents: contents.new ?? "" },
      }
    },
    [engine, space, ask]
  )

  return { byPath, missing, loading, load, whole }
}

/** The end of the files drawn, while more wait: they load as it shows. */
function More({
  left,
  loading,
  onSeen,
}: {
  left: number
  loading: boolean
  onSeen: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const seen = useEffectEvent(onSeen)
  useEffect(() => {
    const element = box.current
    if (!element) return
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) seen()
      },
      { rootMargin: "600px" }
    )
    watch.observe(element)
    return () => watch.disconnect()
  }, [])
  return (
    <div
      ref={box}
      className="flex h-12 items-center justify-center gap-2 text-xs text-muted-foreground"
    >
      {loading && <Spinner className="size-3" />}
      {left === 1 ? "1 more file" : `${left} more files`}
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

/** The scope menu, as T3 Code's: Changes, Uncommitted, Staged, and the
 * branch's commits in a submenu, read as it opens. */
function ScopeMenu({
  engine,
  space,
  scope,
  onChange,
}: {
  engine: Engine
  space: SpaceId
  scope: Scope
  onChange: (scope: Scope) => void
}) {
  const base = scope.kind === "changes" ? scope.base : null
  const commits = useReadOnOpen(
    useCallback(
      () =>
        engine.call("git.commits", base === null ? {} : { base }, { space }),
      [engine, space, base]
    )
  )
  const value = scope.kind === "commit" ? `commit:${scope.sha}` : scope.kind
  return (
    <DropdownMenu onOpenChange={commits.onOpenChange}>
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
            else if (next === "uncommitted" || next === "staged")
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
            value="staged"
            name="Staged"
            about="What a commit would take"
          />
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Commits</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-96 w-80 overflow-y-auto">
            <DropdownMenuGroup>
              <Listed read={commits.list} none="No commits on this branch">
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
function BaseMenu({
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
