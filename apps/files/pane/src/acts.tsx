/**
 * What Files does with files, as the Person sees it done (ADR 0073,
 * decision 10): each operation asks the engine, then a toast says what
 * happened with Undo, and the window keeps it to undo with Mod+Z. A move
 * or a copy is a job: a name taken asks the Person first, and one that
 * takes a while shows how far it is in its toast, with Stop.
 */
import type { Engine, ProjectId } from "@banda/contract"
import type { Clash, Clashing, Done, Making, Step } from "@banda/contract/files"
import { toast } from "@banda/ui/components/sonner"
import { problem } from "@banda/ui/lib/words"
import {
  lastPiece,
  remember,
  runSteps,
  take,
  takeLatest,
  type Undoable,
} from "./undo"
import { nameOf } from "./where"
import { sizeWords } from "./words"

/** Where an act runs: the engine, and the Project its paths are read in. */
export type At = { engine: Engine; project: ProjectId }

/** Asks the Person what to do with the names taken in `dir`: their
 * answers by path, or none when they stopped. */
export type Asker = (
  clashes: readonly Clashing[],
  dir: string
) => Promise<Record<string, Exclude<Clash, "ask">> | null>

/** What hears the Trash change, as Files sends to it or takes from it:
 * the Trash place lists it again. */
const trashHeard = new Set<() => void>()

/** Hears each change Files makes to the Trash; returns how to stop. */
export function hearTrash(listener: () => void): () => void {
  trashHeard.add(listener)
  return () => trashHeard.delete(listener)
}

/** Says Files changed the Trash. */
export function toldTrash(): void {
  for (const listener of trashHeard) listener()
}

/** How long a job runs before its toast shows how far it is, in ms. */
const QUIET = 400

/** What some whole paths are, for a toast: the one's name, or how many. */
const itemsWords = (paths: readonly string[]) =>
  paths.length === 1 ? `“${nameOf(paths[0])}”` : `${paths.length} items`

/** Says `title` happened, with Undo while `steps` can undo it; keeps it
 * to undo with Mod+Z. */
export function said(
  at: At,
  title: string,
  steps: readonly Step[],
  more: { id?: string; description?: string; quiet?: true } = {}
): Undoable {
  const { quiet, ...shown } = more
  const done: Undoable = { title, project: at.project, steps }
  remember(done)
  if (quiet) return done
  // Over a job's toast, by its id: its own time again, and no Stop.
  toast(title, {
    ...shown,
    duration: undefined,
    action:
      steps.length > 0
        ? { label: "Undo", onClick: () => void undo(at, done, true) }
        : undefined,
    cancel: undefined,
  })
  return done
}

/** Undoes `done`, as its toast's Undo or Mod+Z asks; says so. */
async function undo(at: At, done: Undoable, own: boolean): Promise<void> {
  if (own && !take(done)) return
  try {
    await runSteps(at.engine, done.project, done.steps)
    toast(`Undid: ${lower(done.title)}`)
  } catch (error) {
    toast.error(`Could not undo: ${problem(error)}`)
  }
  if (
    done.steps.some((step) => step.kind === "trash" || step.kind === "restore")
  )
    toldTrash()
}

/** Undoes the latest operation in the Project; whether there was one. */
export function undoLatest(at: At): boolean {
  const latest = takeLatest(at.project)
  if (!latest) return false
  void undo(at, latest, false)
  return true
}

const lower = (title: string) => title.charAt(0).toLowerCase() + title.slice(1)

/** Makes an empty file or folder named `name` in `dir`, kept to undo
 * but not said, as it is named next; none when it was refused, as a
 * toast says. */
export async function make(
  at: At,
  dir: string,
  name: string,
  kind: Making
): Promise<Undoable | null> {
  try {
    const done = await at.engine.command(
      "files.make",
      { dir, name, kind },
      at.project
    )
    return said(at, `Made “${name}”`, done.undo, { quiet: true })
  } catch (error) {
    toast.error(problem(error))
    return null
  }
}

/** Renames `path` to `name`, and says so; whether it was. With `made`,
 * the thing was made just now, and is said made under its name. */
export async function rename(
  at: At,
  path: string,
  name: string,
  made?: Undoable
): Promise<boolean> {
  try {
    const done = await at.engine.command(
      "files.rename",
      { path, name },
      at.project
    )
    if (made && take(made))
      said(at, `Made “${name}”`, [{ kind: "trash", paths: done.paths }])
    else said(at, `Renamed “${nameOf(path)}” to “${name}”`, done.undo)
    return true
  } catch (error) {
    toast.error(problem(error))
    return false
  }
}

/** Renames each of `renames`, in their order, and says so as one, undone
 * as one: what was renamed before one failed stays, and is undone too.
 * Whether all were. */
export async function renameAll(
  at: At,
  renames: readonly { path: string; name: string }[]
): Promise<boolean> {
  const undo: Step[] = []
  let failed: string | undefined
  for (const { path, name } of renames) {
    try {
      const done = await at.engine.command(
        "files.rename",
        { path, name },
        at.project
      )
      undo.unshift(...done.undo)
    } catch (error) {
      failed = problem(error)
      break
    }
  }
  const named = new Set(renames.map((one) => one.path)).size
  said(at, `Renamed ${named} ${named === 1 ? "item" : "items"}`, undo, {
    description: failed,
  })
  if (failed) toast.error(failed)
  return failed === undefined
}

/** Sends `paths` to the Trash, and says so. */
export async function trash(
  at: At,
  paths: readonly string[]
): Promise<boolean> {
  try {
    const done = await at.engine.command(
      "files.trash",
      { paths: [...paths] },
      at.project
    )
    said(at, `Moved ${itemsWords(paths)} to the Trash`, done.undo, {
      description:
        done.failed ??
        (done.undo.length === 0 ? "Finder puts it back." : undefined),
    })
    toldTrash()
    return true
  } catch (error) {
    toast.error(problem(error))
    return false
  }
}

/**
 * Moves or copies `paths` into `dir`, a job: the names taken there are
 * asked about first (unless `clash` answers them all), a long one shows
 * how far it is with Stop, and the end is said with Undo. What it did, or
 * none when it was stopped before it began or refused.
 */
export async function transfer(
  at: At,
  {
    copy,
    paths,
    dir,
    clash = "ask",
    ask,
    beside = false,
  }: {
    copy: boolean
    paths: readonly string[]
    dir: string
    clash?: Clash
    ask: Asker
    /** A copy beside itself: a duplicate. */
    beside?: boolean
  }
): Promise<Done | null> {
  const job = crypto.randomUUID()
  const id = `files.job.${job}`
  const doing = copy ? "Copying" : "Moving"
  let answers: Record<string, Exclude<Clash, "ask">> = {}
  let shown = false
  let stopping = false
  // The toast stays, to say how it stopped.
  const stop = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    stopping = true
    void at.engine.command("files.cancel", { job }, at.project).catch(() => {})
  }
  try {
    for (;;) {
      // Quiet at first: a quick one only says its end.
      let last = { done: 0, of: 0, name: "" }
      const show = () => {
        shown = true
        toast(stopping ? `Stopping…` : `${doing} ${itemsWords(paths)}…`, {
          id,
          duration: Infinity,
          description: <Progress {...last} />,
          action: { label: "Stop", onClick: stop },
        })
      }
      const timer = setTimeout(show, QUIET)
      const end = await lastPiece(
        at.engine,
        at.project,
        copy ? "files.copy" : "files.move",
        { paths: [...paths], dir, clash, answers, job },
        (piece) => {
          if (piece.kind !== "progress") return
          last = piece
          if (shown) show()
        }
      ).finally(() => clearTimeout(timer))
      if (end.kind === "clashes") {
        if (shown) toast.dismiss(id)
        shown = false
        const more = await ask(end.clashes, nameOf(dir))
        if (!more) return null
        answers = { ...answers, ...more }
        continue
      }
      const done = end
      const title = done.stopped
        ? `Stopped: ${done.paths.length} of ${paths.length} ${copy ? "copied" : "moved"}`
        : done.paths.length === 0
          ? `Nothing ${copy ? "copied" : "moved"}`
          : beside
            ? paths.length === 1
              ? `Duplicated “${nameOf(paths[0])}” as ${itemsWords(done.paths)}`
              : `Duplicated ${done.paths.length} items`
            : `${copy ? "Copied" : "Moved"} ${itemsWords(done.paths)} to “${nameOf(dir)}”`
      const skipped = done.skipped?.length
      said(at, title, done.undo, {
        id,
        description:
          done.failed ?? (skipped ? `${skipped} skipped.` : undefined),
      })
      if (done.failed) toast.error(done.failed)
      if (done.undo.some((step) => step.kind === "restore")) toldTrash()
      return done
    }
  } catch (error) {
    if (shown) toast.dismiss(id)
    toast.error(problem(error, copy ? "the copy" : "the move"))
    return null
  }
}

/** How far a job is: its bytes, and a thin bar. */
function Progress({
  done,
  of,
  name,
}: {
  done: number
  of: number
  name: string
}) {
  const part = of > 0 ? Math.min(1, done / of) : 0
  return (
    <span className="flex w-56 flex-col gap-1">
      <span className="truncate">
        {of > 0 ? `${sizeWords(done)} of ${sizeWords(of)}` : "Starting…"}
        {name && ` · ${name}`}
      </span>
      <span
        role="progressbar"
        aria-label="How far it is"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(part * 100)}
        className="block h-1 w-full overflow-hidden rounded-full bg-foreground/10"
      >
        <span
          className="block h-full rounded-full bg-foreground/60 transition-[width]"
          style={{ width: `${part * 100}%` }}
        />
      </span>
    </span>
  )
}
