import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { ChangeAsk } from "@banda/contract/git"
import { Button } from "@banda/ui/components/button"
import {
  CodeDiff,
  pathOf,
  type CodeDiffHandle,
  type FileDiffMetadata,
} from "@banda/ui/components/code-diff"
import { DiffCounts } from "@banda/ui/components/diff"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@banda/ui/components/empty"
import { ChangedFiles, type TreeFile } from "@banda/ui/components/file-tree"
import { DETAILS_WIDE } from "@banda/ui/components/thread-details"
import { PaneHeader } from "@banda/ui/components/pane-header"
import { Spinner } from "@banda/ui/components/spinner"
import { useAct } from "@banda/ui/hooks/use-act"
import { useWiderThan } from "@banda/ui/hooks/use-wider-than"
import { definePane, type PaneProps } from "@banda/ui/pane"
import { ChevronDownIcon, ChevronRightIcon, FileDiffIcon } from "lucide-react"
import { Acts } from "./Acts"
import { AT_ONCE, viewOf, type View } from "./diff"
import { DiffToolbar } from "./DiffToolbar"
import { More, useFiles } from "./files"
import { useFolds } from "./folds"
import { useDiffRead, type Drawn } from "./read"
import { BaseMenu, ScopeMenu } from "./ScopeMenu"
import { CHANGES, changeOf, isTest, labelOf, type Scope } from "./scope"
import { actsOf, allOf, fileAsk, hunkAsk, type Act } from "./stage"
import { filesOf } from "./status"
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
  view?: Partial<View>
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

function DiffPane({ engine, space, args, update, close }: PaneProps<DiffArgs>) {
  const scope = args.scope
  // As wide as a Thread holds its card beside the messages, the tree has
  // room beside the lines; narrower, as at half a screen, it would take
  // theirs.
  const root = useRef<HTMLDivElement>(null)
  const view = viewOf(args.view, useWiderThan(root, DETAILS_WIDE))
  // What the Person chose alone is kept: the tree they never toggled
  // follows the Pane's width.
  const set = (next: Partial<View>) =>
    update({ ...args, view: { ...args.view, ...next } })

  const thread = scope.kind === "turn" ? scope.thread : (args.thread ?? null)
  const { live, diff, question, words, again, fresh } = useDiffRead(
    engine,
    space,
    scope,
    view.ignoreWhitespace
  )

  // Git's files load and expand from git. A turn's files drawn from its
  // tool calls come whole, so git is never asked for them.
  const ask = diff ? question : null
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

  const viewer = useRef<CodeDiffHandle>(null)
  const { folded, flip, allFolded, foldAll, selected, reveal } = useFolds(
    shown,
    files,
    viewer
  )

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
        fresh()
      })
  }
  // What went wrong shows until the next try, or until dismissed.
  const [dismissed, setDismissed] = useState<string>()
  const failed = acting.problem !== dismissed ? acting.problem : undefined

  const added = diff?.files.reduce((sum, file) => sum + file.added, 0) ?? 0
  const removed = diff?.files.reduce((sum, file) => sum + file.removed, 0) ?? 0
  const count = diff?.files.length ?? 0

  return (
    <div ref={root} className="@container/diff flex h-full min-h-0 flex-col">
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
            {filesOf(count)}
            {added + removed > 0 && <span aria-hidden>·</span>}
            <DiffCounts added={added} removed={removed} />
          </span>
        )}
        <DiffToolbar
          view={view}
          onView={set}
          onAgain={again}
          folded={shown.length > 0 ? allFolded : null}
          onFold={foldAll}
        >
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
        </DiffToolbar>
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
