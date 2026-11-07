/**
 * A file the Person edits in Files (ADR 0073, decision 8), kept while the
 * window runs, one for each file however many Panes show it: what the
 * disk holds, the Person's text not saved yet, and its saves.
 *
 * A save goes 500 ms after typing stops, at once when asked, and as the
 * last Pane of the file lets go of it; one at a time and in order, each
 * over the hash its text was made from. When the disk moves under text
 * not saved, nothing is written over it: the draft says so and keeps the
 * Person's text, until they take the disk's or keep theirs. A change on
 * disk under no unsaved text is taken as it is. Pure of React and the
 * engine, so plain tests cover it.
 */
import type { Participant } from "@banda/contract"
import type { Written } from "@banda/contract/files"
import { problem } from "@banda/ui/lib/words"

/** How long typing rests before it is saved, in ms. */
export const WAIT = 500

/** A file's text on disk, and its hash; null when it is gone. */
export type Disk = { text: string; hash: string } | null

/** The disk moved under the Person's text. */
export type Moved = {
  /** Its hash now; none when it is gone. */
  hash: string | null
  /** When it was found, in ms since the epoch. */
  at: number
  /** Who wrote it, when the engine knows. */
  by?: Participant
}

export type DraftState = {
  /** What the disk holds, as read last; undefined before the first read. */
  disk: Disk | undefined
  /** The text known to be on disk at `base`: read, or saved. */
  held: string
  /** The hash of `held`, which the next save is made over; null for a
   * file that is not there. */
  base: string | null
  /** How many times the disk's text was taken for the Person's: an
   * editor drawn starts again from it. */
  taken: number
  /** The Person's text, while it is not saved. */
  mine: string | null
  /** A save is under way. */
  saving: boolean
  /** When a save last landed, in ms since the epoch. */
  saved: number | null
  moved: Moved | null
  /** Why the last save failed, when the disk did not move. */
  failed: string | null
  /** How many times the disk is to be read again: once after each save,
   * as a read that came meanwhile may be from before it. */
  reads: number
}

/** Writes `text` over `base`, as `files.write` does. */
export type Write = (text: string, base: string | null) => Promise<Written>

/** The Person's text now, saved or not. */
export function textOf(state: DraftState): string {
  return state.mine ?? state.held
}

export class Draft {
  #state: DraftState = {
    disk: undefined,
    held: "",
    base: null,
    taken: 0,
    mine: null,
    saving: false,
    saved: null,
    moved: null,
    failed: null,
    reads: 0,
  }
  #timer: ReturnType<typeof setTimeout> | undefined
  /** A save is owed as soon as the one under way lands. */
  #due = false
  readonly #write: Write
  readonly #changed: () => void
  readonly #now: () => number

  constructor(options: {
    write: Write
    /** Hears each change of its state. */
    changed: () => void
    now?: () => number
  }) {
    this.#write = options.write
    this.#changed = options.changed
    this.#now = options.now ?? Date.now
  }

  get state(): DraftState {
    return this.#state
  }

  #set(next: Partial<DraftState>): void {
    this.#state = { ...this.#state, ...next }
    this.#changed()
  }

  /** The disk, as just read. */
  read(disk: Disk): void {
    const was = this.#state
    if (was.disk === undefined) {
      this.#set({ disk, held: disk?.text ?? "", base: disk?.hash ?? null })
      return
    }
    // A read that comes while a save is under way may be from before it:
    // the disk is read again once the save lands.
    if (was.saving) return
    const hash = disk?.hash ?? null
    if (hash === was.base) {
      // Back where the Person's text was made: it may be saved again.
      this.#set({ disk, moved: null })
      if (was.moved && was.mine !== null) this.#later()
    } else if (was.mine === null) {
      this.#take(disk)
    } else {
      const same = was.moved?.hash === hash ? was.moved : null
      this.#set({ disk, moved: same ?? { hash, at: this.#now() } })
    }
  }

  /** The Person's text, as they just typed it: saved once typing rests. */
  type(text: string): void {
    const was = this.#state
    // Text that is on disk needs no save, unless one under way would
    // put another there.
    const mine = text === was.held && !was.saving ? null : text
    if (mine === was.mine) return
    this.#set({ mine })
    if (mine === null) clearTimeout(this.#timer)
    else this.#later()
  }

  /** Saves now what waits to be: after the save under way, if one is. */
  flush(): void {
    clearTimeout(this.#timer)
    this.#save()
  }

  /** Drops the Person's text for what the disk holds. */
  takeTheirs(): void {
    const disk = this.#state.disk
    if (disk === undefined) return
    clearTimeout(this.#timer)
    this.#due = false
    this.#take(disk)
  }

  /** The disk's text, `disk`, in place of the Person's. */
  #take(disk: Disk): void {
    this.#set({
      disk,
      held: disk?.text ?? "",
      base: disk?.hash ?? null,
      taken: this.#state.taken + 1,
      mine: null,
      moved: null,
      failed: null,
    })
  }

  /** Writes the Person's text over what the disk holds now. */
  keepMine(): void {
    const moved = this.#state.moved
    if (!moved) return
    this.#set({ base: moved.hash, moved: null })
    this.flush()
  }

  #later(): void {
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.#save(), WAIT)
  }

  #save(): void {
    const was = this.#state
    if (was.saving) {
      this.#due = true
      return
    }
    const text = was.mine
    if (text === null || was.moved) return
    this.#set({ saving: true, failed: null })
    this.#write(text, was.base).then(
      (written) => {
        const now = this.#state
        if (written.kind === "written")
          this.#set({
            saving: false,
            held: text,
            base: written.hash,
            mine: now.mine === text ? null : now.mine,
            saved: this.#now(),
            reads: now.reads + 1,
          })
        else
          this.#set({
            saving: false,
            moved: {
              hash: written.hash,
              at: this.#now(),
              ...(written.by && { by: written.by }),
            },
            reads: now.reads + 1,
          })
        if (this.#due) {
          this.#due = false
          this.#save()
        }
      },
      (error: unknown) => {
        this.#due = false
        this.#set({ saving: false, failed: problem(error) })
      }
    )
  }
}

/** A draft, and how many Panes hold it. */
type Kept = { draft: Draft; holders: number }

/** The drafts kept, by Project and file. */
const drafts = new Map<string, Kept>()
/** What hears any draft change, or one come or go. */
const hearing = new Set<() => void>()

function tell(): void {
  for (const hear of hearing) hear()
}

/** What a draft is kept by: its Project and its file, whole. */
export function draftKey(project: string, path: string): string {
  return `${project}\0${path}`
}

/** Forgets the draft of `key` once no Pane holds it and nothing of it is
 * left to save. One the disk moved under, or whose save failed, stays
 * while the window runs, so a Pane of its file opened again has it. */
function forgetIfDone(key: string): void {
  const kept = drafts.get(key)
  if (!kept || kept.holders > 0) return
  const { saving, mine } = kept.draft.state
  if (!saving && mine === null) drafts.delete(key)
}

/**
 * Holds the draft of `key`, made with `write` when none is kept; returns
 * it, and how to let go of it. The last to let go saves at once what
 * waits to be.
 */
export function holdDraft(key: string, write: Write): [Draft, () => void] {
  let kept = drafts.get(key)
  if (!kept) {
    kept = {
      draft: new Draft({
        write,
        changed: () => {
          forgetIfDone(key)
          tell()
        },
      }),
      holders: 0,
    }
    drafts.set(key, kept)
    tell()
  }
  const held = kept
  held.holders++
  let holding = true
  return [
    held.draft,
    () => {
      if (!holding) return
      holding = false
      held.holders--
      if (held.holders > 0) return
      held.draft.flush()
      forgetIfDone(key)
      tell()
    },
  ]
}

/** The draft kept of `key`, if one is. */
export function draftOf(key: string): Draft | undefined {
  return drafts.get(key)?.draft
}

/** Hears every draft's changes; returns how to stop. */
export function hearDrafts(hear: () => void): () => void {
  hearing.add(hear)
  return () => hearing.delete(hear)
}
