import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Refused } from "@banda/contract"
import type { ChangesAsk } from "@banda/contract/agents"
import type { ChangeAsk, Diff, DiffAsk } from "@banda/contract/git"
import { Button } from "@banda/ui/components/button"
import {
  CodeDiff,
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
import { useAct } from "@banda/ui/hooks/use-act"
import { useInFront } from "@banda/ui/hooks/use-in-front"
import { READ_AGAIN, useLive, type Source } from "@banda/ui/hooks/use-live"
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
import { Acts } from "./Acts"
import { AT_ONCE, asked, viewOf, type View } from "./diff"
import { More, turnRead, useFiles, type Drawn } from "./files"
import { BaseMenu, ScopeMenu } from "./ScopeMenu"
import { CHANGES, changeOf, isTest, labelOf, type Scope } from "./scope"
import { actsOf, allOf, fileAsk, hunkAsk, type Act } from "./stage"
import { useGitStatus } from "./status"
import { GitAlert } from "./GitAlert"

/**
 * What changed in the Space's folder, as T3 Code's Diff shows it (ADR
 * 0034, decision 2): one Pane, its scope chosen from a menu in its header,
 * files drawn by `@pierre/diffs` beside a tree of them. It reads again as
 * an Agent's turn ends, as the folder's status changes, as the window
 * comes back, and on its button.
 */
type DiffArgs = {
  scope: Scope
  /** How it draws; none draws as T3 Code's (`VIEW`), as a Diff an Agent
   * or a Thread opens. */
  view?: View
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
  start: { scope: CHANGES, file: null },
  header: false,
  // One Diff per Space: another scope is the same Pane.
  identity: () => "diff",
  Pane: DiffPane,
})

/** What makes the Diff read again: an Agent's turn ending. */
const TURNS = { module: "agents", kinds: ["turn.ended"] }

/** Whether two reads of git's diff say the same. */
function sameDiff(a: Diff, b: Diff): boolean {
  return (
    a.patch === b.patch &&
    a.truncated === b.truncated &&
    JSON.stringify([a.files, a.base]) === JSON.stringify([b.files, b.base])
  )
}

/** Calls `changed` with `value` as it changes from what it was, as the
 * Pane draws; none (`null`) is no value, and is not heard. */
function useChanged<T>(value: T | null, changed: (now: T) => void): void {
  const [was, setWas] = useState(value)
  if (value === null || value === was) return
  setWas(value)
  if (was !== null) changed(value)
}

/** Git has no checkpoint of the turn, or the folder is no repository. */
function noCheckpoint(error: unknown): boolean {
  if (!(error instanceof Refused)) return false
  const { code } = error.refusal
  return code === "not_found" || code === "conflict"
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
  useChanged(front, (now) => now && again())
  // And, while in front, as the folder changes under it as the card sees
  // it: a commit, a pull or a switch from the card or a terminal, a file
  // written. A turn's or a commit's changes stay what they were.
  const follows = front && scope.kind !== "turn" && scope.kind !== "commit"
  const status = useGitStatus(engine, space, follows)
  const seen = useMemo(() => {
    if (!status) return null
    if (scope.kind === "staged")
      return JSON.stringify([
        status.head,
        status.files.map((file) => [file.path, file.staged]),
      ])
    return JSON.stringify([status.head, status.branch, status.files])
  }, [status, scope.kind])
  useChanged(seen, again)

  const thread = scope.kind === "turn" ? scope.thread : (args.thread ?? null)
  // The question's words decide: the same words ask the same.
  const words = JSON.stringify({
    scope: asked(scope),
    ignore_whitespace: view.ignoreWhitespace,
  })
  const question = useMemo(() => JSON.parse(words) as DiffAsk, [words])
  // A read the same as the last keeps its view, so nothing is drawn again.
  const last = useRef<Drawn>(undefined)
  const source = useMemo<Source<Drawn>>(() => {
    const diff = () => engine.call("git.diff", question, { space })
    const turn = question.scope.kind === "turn" ? question.scope : null
    if (!turn)
      return {
        read: async () => {
          const read: Drawn = await diff()
          const was = last.current
          if (was && sameDiff(was, read)) {
            was.at = read.at
            return was
          }
          last.current = read
          return read
        },
        filter: TURNS,
        apply: () => READ_AGAIN,
      }
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
        // The read after is a new view, though it says the same.
        last.current = undefined
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
              onAct={(what) => act(what, allOf(visible, files.byPath))}
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
        <GitAlert
          className="shrink-0 items-center border-b px-3 py-1"
          onDismiss={() => setDismissed(failed)}
        >
          {failed}
        </GitAlert>
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
