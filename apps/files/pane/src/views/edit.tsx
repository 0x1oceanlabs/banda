/**
 * Editing a file's text in Files (ADR 0073, decision 8), as the code and
 * markdown views share it: the file's draft, which saves as one types; the
 * header's pencil, which E turns on and Esc off; Ctrl+S (⌘S), which saves
 * at once; the bar that says the disk moved under the Person's text, with
 * Compare, Take theirs and Keep mine; and a task's box ticked. While Edit
 * is on, Follow waits (decision 9).
 */
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type { Touched } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import { CodeDiff, fileOf } from "@banda/ui/components/code-diff"
import type { Editor } from "@banda/ui/components/code-file"
import { InHeader } from "@banda/ui/components/pane-header"
import { FIELDS, matches } from "@banda/ui/lib/keys"
import type { PreviewProps } from "@banda/ui/module"
import { PencilIcon } from "lucide-react"
import {
  type Disk,
  draftKey,
  draftOf,
  type DraftState,
  hearDrafts,
  holdDraft,
  textOf,
} from "../draft"
import {
  heardWrites,
  lockedWhy,
  tickTask,
  type Wrote,
  writtenBy,
} from "../edits"
import { HeaderButton } from "../HeaderButton"
import { useThreads } from "../live"
import { useText } from "../read"
import { useHolding } from "../work"

/** Edit, where nothing else takes the key. */
const EDIT = { code: "KeyE" }
/** Saves at once: the Pane's own key, Ctrl's (⌘ on a Mac). */
const SAVE = { code: "KeyS", primary: true }

/** What a press is typed into, which keeps its keys. */
function typing(event: globalThis.KeyboardEvent): boolean {
  const at = event.composedPath()[0]
  return (
    at instanceof HTMLElement && (at.isContentEditable || at.matches(FIELDS))
  )
}

/**
 * What the code and markdown views draw a file's text with: its text read
 * from the disk, and, while Files may write it, its draft, the text shown
 * (the Person's, saved or not), and what the editor starts from while it
 * shows.
 */
export function useEditing(props: PreviewProps) {
  const { engine, project, file, mode, kept, keep } = props
  const key = draftKey(project, file.path)
  // The file's draft, as kept: held here or by another Pane.
  const held = useSyncExternalStore(
    hearDrafts,
    () => draftOf(key)?.state ?? null
  )
  // Read again after each save: a read that came meanwhile may be older.
  const reads = held?.reads ?? 0
  const read = useText(engine, project, file.path, file.modified, reads)
  const drawn = read && "drawn" in read ? read.drawn : null
  const why =
    drawn &&
    lockedWhy({
      mode,
      binary: drawn.text === undefined,
      cut: drawn.cut,
      locked: drawn.locked,
    })
  // One for each read, the same text read again too: a read the draft
  // set aside while it saved is told again by the next.
  const disk = useMemo<Disk | undefined>(
    () =>
      why === null && drawn?.text !== undefined && drawn.hash !== undefined
        ? { text: drawn.text, hash: drawn.hash }
        : undefined,
    [why, drawn]
  )

  // The draft is held while the file may be edited, and told each read.
  const holds = disk !== undefined
  const path = file.path
  useEffect(() => {
    if (!holds) return
    const write = (text: string, base: string | null) =>
      engine.command("files.write", { path, text, base }, project)
    return holdDraft(key, write)[1]
  }, [engine, project, key, path, holds])
  useEffect(() => {
    if (disk) draftOf(key)?.read(disk)
  }, [key, disk])
  // Ready once it has read the disk.
  const state = holds && held?.disk !== undefined ? held : null
  const heard = useWrites(props, holds)

  const on = kept.edit === true && state !== null
  // While the Person edits, Follow waits.
  useHolding(project, on)
  const [comparing, setComparing] = useState(false)
  const compare = comparing && state?.moved != null
  if (comparing && !compare) setComparing(false)

  // What the editor starts from: the Person's text as it comes, and the
  // disk's each time that is taken. Drawn anew, it starts from the same
  // text Pierre kept its history of.
  const shows = on && !compare
  const [start, setStart] = useState<{ taken: number; text: string } | null>(
    null
  )
  if (shows && state && start?.taken !== state.taken)
    setStart({ taken: state.taken, text: textOf(state) })
  else if (!shows && start !== null) setStart(null)

  const tick = useCallback(
    (nth: number, done: boolean, of: number, from: number) => {
      const draft = draftOf(key)
      const next = draft && tickTask(textOf(draft.state), nth, done, from, of)
      if (!draft || !next) return
      draft.type(next)
      draft.flush()
    },
    [key]
  )
  const save = () => draftOf(key)?.flush()
  const toggle = () => {
    if (!state) return
    if (on) {
      save()
      keep({ ...kept, edit: false })
    } else keep({ ...kept, edit: true })
  }
  const editor: Editor | null =
    shows && start
      ? {
          key: path,
          start: start.taken,
          onChange: (text) => draftOf(key)?.type(text),
          onDone: toggle,
        }
      : null

  return {
    /** What its draft is kept by. */
    key,
    read,
    /** Why it is not edited here; none when it may be, or while it is
     * read. */
    why,
    state,
    on,
    /** Its text as it is shown: the editor's start while it shows. */
    text: start?.text ?? (state ? textOf(state) : drawn?.text),
    editor,
    compare,
    setCompare: setComparing,
    heard,
    toggle,
    save,
    /** The keys of the view's text: E edits, Ctrl+S saves. */
    onKeyDown: (event: KeyboardEvent) => {
      const pressed = event.nativeEvent
      if (matches(pressed, SAVE)) {
        event.preventDefault()
        save()
        return
      }
      if (on || !state || !matches(pressed, EDIT) || typing(pressed)) return
      event.preventDefault()
      toggle()
    },
    /** Ticks a markdown task, counted from `from`, and saves it at once;
     * none while it may not be written. Nothing is ticked when the boxes
     * shown are not the tasks it counts. */
    tick: state ? tick : null,
  }
}

export type Editing = ReturnType<typeof useEditing>

/** What the Project's Agents write, heard while `on`: each turn's file
 * now, and those left off lately. */
function useWrites(
  { engine, project }: Pick<PreviewProps, "engine" | "project">,
  on: boolean
): { touched: readonly Touched[]; wrote: readonly Wrote[] } {
  const [heard, setHeard] = useState<{
    touched: readonly Touched[]
    wrote: readonly Wrote[]
  }>({ touched: [], wrote: [] })
  useEffect(() => {
    if (!on) return
    return engine.stream(
      project,
      "agents.touching",
      {},
      ({ touched }) =>
        setHeard((was) => ({
          touched,
          wrote: heardWrites(was.wrote, was.touched, touched, Date.now()),
        })),
      () => {}
    )
  }, [engine, project, on])
  return heard
}

/** The header's pencil: Edit, or why the file is not edited here. */
export function EditButton({ edit }: { edit: Editing }) {
  if (edit.why === null && !edit.state) return null
  return (
    <InHeader>
      {/* First of the view's: the rest come and go. */}
      <span className="order-first flex">
        <HeaderButton
          label="Edit"
          title={edit.why ?? (edit.on ? "Done editing · Esc" : "Edit · E")}
          on={edit.on}
          disabled={edit.why !== null}
          onClick={edit.toggle}
        >
          <PencilIcon />
        </HeaderButton>
      </span>
    </InHeader>
  )
}

/**
 * Where a file's text is drawn, which takes its keys, under what is
 * wrong with its saves: the disk moved under the Person's text, or a save
 * failed. Compare shows the disk's text against the Person's in place of
 * `children`.
 */
export function Edited({
  edit,
  props,
  children,
}: {
  edit: Editing
  props: PreviewProps
  children: ReactNode
}) {
  const { state, on } = edit
  // The keys come back here from the editor that went, unless the Person
  // went elsewhere meanwhile.
  const box = useRef<HTMLDivElement>(null)
  const was = useRef(on)
  useEffect(() => {
    const at = document.activeElement
    const own = box.current
    if (was.current && !on && own && (at === document.body || own.contains(at)))
      own.focus({ preventScroll: true })
    was.current = on
  }, [on])
  return (
    <div
      ref={box}
      tabIndex={-1}
      data-keys=""
      className="flex min-h-0 flex-1 flex-col outline-none"
      onKeyDown={edit.onKeyDown}
    >
      {state?.moved && (
        <Moved
          edit={edit}
          state={state}
          props={props}
          // The keys go back to the text, which the bar's buttons took.
          back={() =>
            requestAnimationFrame(() =>
              box.current?.focus({ preventScroll: true })
            )
          }
        />
      )}
      {state?.failed && !state.moved && (
        <Bar label="Not saved">
          <span className="min-w-36 flex-1">Not saved: {state.failed}</span>
          <Button variant="outline" size="xs" onClick={edit.save}>
            Try again
          </Button>
        </Bar>
      )}
      {edit.compare && state ? (
        <Compare
          name={props.file.name}
          theirs={state.disk?.text ?? ""}
          mine={textOf(state)}
          wrap={props.kept.wrap === true}
        />
      ) : (
        children
      )}
    </div>
  )
}

function Bar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="alert"
      aria-label={label}
      className="flex shrink-0 animate-in flex-wrap items-center gap-x-2 gap-y-1 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-meta fade-in-0 motion-reduce:animate-none"
    >
      {children}
    </div>
  )
}

/** The disk moved under the Person's text: who moved it, as far as is
 * known, and what to do with the two. */
function Moved({
  edit,
  state,
  props,
  back,
}: {
  edit: Editing
  state: DraftState
  props: PreviewProps
  back: () => void
}) {
  const { engine, project, file } = props
  const moved = state.moved!
  const threads = useThreads(engine, project)
  const thread = writtenBy(
    edit.heard.touched,
    edit.heard.wrote,
    [file.path, file.shown],
    moved.at
  )
  const by = moved.by
  const named =
    threads.find((one) => one.id === thread) ??
    (by?.kind === "agent"
      ? threads.find((one) => one.agent === by.id)
      : undefined)
  const who = named
    ? "the Agent"
    : by?.kind === "person"
      ? "you, elsewhere"
      : "another app"
  // Theirs is known once the disk is read at the hash it moved to.
  const read = (state.disk?.hash ?? null) === moved.hash
  const draft = () => draftOf(edit.key)
  return (
    <Bar label="Changed on disk">
      <span className="min-w-36 flex-1">
        {moved.hash === null ? "Deleted" : "Changed"} on disk by{" "}
        <span className="font-medium">{who}</span>
        {named?.title && (
          <span className="text-muted-foreground"> in “{named.title}”</span>
        )}
        .{" "}
        {edit.compare
          ? "Red is on disk, green is yours."
          : "Your text is kept."}
      </span>
      <Button
        variant="ghost"
        size="xs"
        className="aria-pressed:bg-muted aria-pressed:text-foreground"
        aria-pressed={edit.compare}
        disabled={!read}
        onClick={() => {
          edit.setCompare(!edit.compare)
          back()
        }}
      >
        Compare
      </Button>
      <Button
        variant="outline"
        size="xs"
        disabled={!read}
        onClick={() => {
          draft()?.takeTheirs()
          back()
        }}
      >
        Take theirs
      </Button>
      <Button
        size="xs"
        onClick={() => {
          draft()?.keepMine()
          back()
        }}
      >
        Keep mine
      </Button>
    </Bar>
  )
}

const NONE: ReadonlySet<string> = new Set()

/** The disk's text against the Person's, in the shared diff view: what
 * Keep mine would write over theirs. */
function Compare({
  name,
  theirs,
  mine,
  wrap,
}: {
  name: string
  theirs: string
  mine: string
  wrap: boolean
}) {
  const files = useMemo(
    () => [fileOf(name, theirs, mine)],
    [name, theirs, mine]
  )
  return (
    <CodeDiff
      className="min-h-0 flex-1"
      files={files}
      folded={NONE}
      layout="stacked"
      wrap={wrap}
    />
  )
}
