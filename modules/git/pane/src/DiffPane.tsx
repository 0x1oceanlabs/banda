import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Refused, type Engine, type SpaceId } from "@banda/contract"
import type {
  ChangedTurn,
  ChangesAsk,
  TurnChanges,
} from "@banda/contract/agents"
import type { ChangeAsk, Diff, DiffAsk } from "@banda/contract/git"
import { Button } from "@banda/ui/components/button"
import {
  CodeDiff,
  countsOf,
  fileOf,
  filesOf,
  keyOf,
  pathOf,
  type CodeDiffHandle,
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
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { Spinner } from "@banda/ui/components/spinner"
import { useAct } from "@banda/ui/hooks/use-act"
import { useInFront } from "@banda/ui/hooks/use-in-front"
import { READ_AGAIN, useLive, type Source } from "@banda/ui/hooks/use-live"
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
  MinusIcon,
  PlusIcon,
  RefreshCwIcon,
  Rows2Icon,
  Settings2Icon,
  Undo2Icon,
  XIcon,
} from "lucide-react"
import { AT_ONCE, asked, VIEW, viewOf, type View } from "./diff"
import { CHANGES, changeOf, isTest, labelOf, type Scope } from "./scope"
import { actsOf, allOf, fileAsk, hunkAsk, type Act } from "./stage"

/**
 * What changed in the Space's folder, as T3 Code's Diff shows it (ADR
 * 0034, decision 2): one Pane, its scope chosen from a menu in its header,
 * files drawn by `@pierre/diffs` beside a tree of them. It reads again as
 * an Agent's turn ends, as the window comes back, and on its button.
 */
export type DiffArgs = {
  scope: Scope
  view: View
  /** The Thread whose turns the menu offers, kept as the scope leaves a
   * turn: the one it was opened on. */
  thread?: string | null
  /** The file to show once it is read, as a Thread's changed file opens. */
  file: string | null
}

export const diffPane = definePane<DiffArgs>({
  kind: "git.diff",
  title: () => "Diff",
  detail: (args) => labelOf(args.scope),
  icon: FileDiffIcon,
  letter: "D",
  start: { scope: CHANGES, view: VIEW, file: null },
  header: false,
  // One Diff per Space: another scope is the same Pane.
  identity: () => "diff",
  Pane: DiffPane,
})

/** What makes the Diff read again: an Agent's turn ending. */
const TURNS = { module: "agents", kinds: ["turn.ended"] }

/** What the Pane draws, as git answers it; a turn's changes from its tool
 * calls come as their files already diffed. A turn's come with the
 * Thread's turns that changed files. */
type Drawn = Diff & { drawn?: FileDiffMetadata[]; turns?: ChangedTurn[] }

/** Git has no checkpoint of the turn, or the folder is no repository. */
function noCheckpoint(error: unknown): boolean {
  if (!(error instanceof Refused)) return false
  const { code } = error.refusal
  return code === "not_found" || code === "conflict"
}

/** A turn's changes as the Pane draws a diff: each file diffed from its
 * texts, whole. */
function turnRead(changes: TurnChanges): Drawn {
  const drawn = changes.files.map((file) =>
    fileOf(file.path, file.old, file.new)
  )
  return {
    at: changes.at,
    files: changes.files.map((file, index) => ({
      path: file.path,
      ...countsOf(drawn[index]!),
      binary: false,
    })),
    patch: "",
    truncated: false,
    drawn,
    turns: changes.turns,
  }
}

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

  const thread = scope.kind === "turn" ? scope.thread : (args.thread ?? null)
  // The question's words decide: the same words ask the same.
  const words = JSON.stringify({
    scope: asked(scope),
    ignore_whitespace: view.ignoreWhitespace,
  })
  const question = useMemo(() => JSON.parse(words) as DiffAsk, [words])
  const source = useMemo<Source<Drawn>>(() => {
    const diff = () => engine.call("git.diff", question, { space })
    const turn = question.scope.kind === "turn" ? question.scope : null
    if (!turn) return { read: diff, filter: TURNS, apply: () => READ_AGAIN }
    const changes = (asked: ChangesAsk) =>
      engine.call("agents.changes", asked, { space })
    return {
      read: async () => {
        const [kept, turns] = await Promise.all([
          diff().catch((error: unknown) => {
            if (!noCheckpoint(error)) throw error
            return null
          }),
          changes({ thread: turn.thread }),
        ])
        if (kept) return { ...kept, turns: turns.turns }
        // A turn git kept no checkpoint of, or in a folder that is no
        // repository, is what its tool calls changed.
        return turnRead(await changes({ thread: turn.thread, turn: turn.turn }))
      },
      filter: {
        module: "agents",
        subject: turn.thread,
        kinds: ["turn.ended", "thread.rewound"],
      },
      apply: () => READ_AGAIN,
    }
  }, [engine, space, question])
  const live = useLive(engine, space, source, round)
  const diff = live.state === "ready" ? live.view : undefined

  // A diff git answered loads its files and expands them from git.
  const ask = diff && !diff.drawn ? question : null
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

  const viewer = useRef<CodeDiffHandle>(null)
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

  // A turn opened from its Thread takes the words the engine names it by.
  const named =
    scope.kind === "turn" && !scope.title
      ? diff?.turns?.find((each) => each.turn === scope.turn)?.said
      : undefined
  const nameTurn = useEffectEvent((title: string) => {
    if (scope.kind === "turn") update({ ...args, scope: { ...scope, title } })
  })
  useEffect(() => {
    if (named) nameTurn(named)
  }, [named])

  // The file it was opened on shows once its files are drawn.
  const wanted = args.file ?? null
  const showWanted = useEffectEvent(() => {
    if (wanted === null) return
    // A Thread names a file in the Space's folder from the root, as its
    // tool calls did; the Diff names it from the folder.
    const path = [...files.byPath.keys()].find(
      (each) => each === wanted || wanted.endsWith(`/${each}`)
    )
    if (path === undefined) return
    reveal(path)
    update({ ...args, file: null })
  })
  useEffect(() => {
    // Once the view has drawn them, so it can scroll to it.
    const frame = requestAnimationFrame(() => showWanted())
    return () => cancelAnimationFrame(frame)
  }, [wanted, files.byPath])

  // Staging and reverting, one at a time; the Diff reads again after,
  // and acts again once it has: until then its files are the ones before.
  const acts = actsOf(scope)
  const acting = useAct()
  const [before, setBefore] = useState<Drawn>()
  const busy = acting.busy || (before !== undefined && before === diff)
  const act = (what: Act, ask: ChangeAsk) => {
    if (busy) return
    const shown = diff
    void acting
      .act(() => engine.call(`git.${what}`, ask, { space }))
      .then(() => {
        setBefore(shown)
        again()
      })
  }
  // What went wrong shows until the next try, or until dismissed.
  const [dismissed, setDismissed] = useState<string>()
  const failed = acting.problem !== dismissed ? acting.problem : undefined

  const added = diff?.files.reduce((sum, file) => sum + file.added, 0) ?? 0
  const removed = diff?.files.reduce((sum, file) => sum + file.removed, 0) ?? 0
  const count = diff?.files.length ?? 0

  return (
    <div className="@container/diff flex h-full min-h-0 flex-col">
      <PaneHeader title="Diff" icon={diffPane.icon} onClose={close}>
        <ScopeMenu
          engine={engine}
          space={space}
          scope={scope}
          thread={thread}
          onChange={(next) => update({ ...args, scope: next, thread })}
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
        {count > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
            {count === 1 ? "1 file" : `${count} files`}
            {added + removed > 0 && <span aria-hidden>·</span>}
            <DiffCounts added={added} removed={removed} />
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {visible.length > 0 && acts.length > 0 && (
            <Acts
              acts={acts}
              words="wide"
              disabled={busy}
              what="all"
              asked={
                visible.length === 1
                  ? visible[0]!.path
                  : `all ${visible.length} files`
              }
              about="Every unstaged change in them goes, and an untracked file is deleted."
              onAct={(what) => act(what, allOf(visible))}
            />
          )}
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
      {failed !== undefined && (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs text-destructive"
        >
          <span className="min-w-0 flex-1">{failed}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss"
            onClick={() => setDismissed(failed)}
          >
            <XIcon />
          </Button>
        </div>
      )}
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
            {...(files.whole ? { load: files.whole } : {})}
            {...(acts.length > 0
              ? {
                  actions: (file: FileDiffMetadata) => (
                    <Acts
                      acts={acts}
                      disabled={busy}
                      what={pathOf(file)}
                      about={
                        file.type === "new"
                          ? "This untracked file is deleted."
                          : "Its unstaged changes go."
                      }
                      onAct={(what) => act(what, fileAsk(file))}
                    />
                  ),
                  hunkActions: (file: FileDiffMetadata, hunk: number) => {
                    const ask = hunkAsk(file, hunk)
                    return (
                      ask && (
                        <Acts
                          acts={acts}
                          disabled={busy}
                          words="shown"
                          what="this hunk"
                          about={`Its lines in ${pathOf(file)} go back to what is staged.`}
                          onAct={(what) => act(what, ask)}
                        />
                      )
                    )
                  },
                }
              : {})}
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

const ICONS: Record<Act, typeof PlusIcon> = {
  stage: PlusIcon,
  unstage: MinusIcon,
  revert: Undo2Icon,
}
const NAMES: Record<Act, string> = {
  stage: "Stage",
  unstage: "Unstage",
  revert: "Revert",
}

/** What can be done to a file or a hunk: icons in a file's header, or
 * named on a hunk's plate. Revert asks first. */
function Acts({
  acts,
  disabled,
  words,
  what,
  asked = what,
  about,
  onAct,
}: {
  acts: Act[]
  disabled: boolean
  /** Each is named beside its icon, or only in a wide Diff; its label
   * names it always. */
  words?: "shown" | "wide"
  /** What it is done to, as its label names it. */
  what: string
  /** What it is done to, as Revert's question names it. */
  asked?: string
  /** What reverting it does. */
  about: string
  onAct: (what: Act) => void
}) {
  return (
    <span className="flex items-center gap-0.5">
      {acts.map((each) => {
        const label = `${NAMES[each]} ${what}`
        const look = {
          variant: "ghost" as const,
          size: words ? ("xs" as const) : ("icon-xs" as const),
          "aria-label": label,
          title: label,
          disabled,
        }
        const Icon = ICONS[each]
        const name =
          words === "wide" ? <Wide>{label}</Wide> : words && NAMES[each]
        const face = (
          <>
            <Icon {...(words ? { "data-icon": "inline-start" } : {})} />
            {name}
          </>
        )
        return each === "revert" ? (
          <Revert
            key={each}
            title={`Revert ${asked}?`}
            about={`${about} This can't be undone.`}
            look={look}
            onRevert={() => onAct(each)}
          >
            {face}
          </Revert>
        ) : (
          <Button key={each} {...look} onClick={() => onAct(each)}>
            {face}
          </Button>
        )
      })}
    </span>
  )
}

/** Words a button shows only in a wide Diff; its label keeps them. */
function Wide({ children }: { children: ReactNode }) {
  return <span className="hidden @2xl/diff:inline">{children}</span>
}

/** A Revert button that asks first, as it cannot be undone. */
function Revert({
  title,
  about,
  look,
  onRevert,
  children,
}: {
  title: string
  about: string
  /** The trigger's look, label and whether it is off. */
  look: Parameters<typeof Button>[0]
  onRevert: () => void
  children: ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="text-destructive hover:text-destructive"
            {...look}
          />
        }
      >
        {children}
      </PopoverTrigger>
      <PopoverContent>
        <PopoverTitle className="break-all">{title}</PopoverTitle>
        <PopoverDescription>{about}</PopoverDescription>
        <div className="mt-2 flex justify-end gap-1.5">
          <PopoverClose render={<Button variant="ghost" size="sm" />}>
            Cancel
          </PopoverClose>
          <PopoverClose
            render={<Button variant="destructive" size="sm" />}
            onClick={onRevert}
          >
            Revert
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
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
  unstaged: "Everything changed is staged.",
  staged: "Nothing is staged.",
  commit: "This commit changes no files.",
  turn: "This turn changed no files.",
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
  ask: DiffAsk | null,
  words: string,
  diff: Drawn | undefined
) {
  const patch = diff?.patch ?? ""
  const basis = `${words}:${hashOf(patch)}`
  const drawn = diff?.drawn
  const inPatch = useMemo(
    () => drawn ?? filesOf(patch, basis),
    [drawn, patch, basis]
  )
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
    if (!ask || loading || paths.length === 0) return
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

  // A turn's files come whole; git's are read whole to expand.
  const whole = useMemo(
    () =>
      ask &&
      (async (file: FileDiffMetadata) => {
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
      }),
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

/** The scope menu, as T3 Code's: Changes, Uncommitted, and the Codex
 * app's Unstaged and Staged, and the branch's commits in a submenu, read
 * as it opens. */
function ScopeMenu({
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
