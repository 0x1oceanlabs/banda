/**
 * The Person names a thing a module lists, as a Thread (ADR 0077): where
 * its field is open, which titles a model is writing now, and the acts
 * the Thread menu and its keys share. The thing is its module's, which
 * says how to rename it (`Module.listed`).
 */
import { useSyncExternalStore } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import { toast } from "@banda/ui/components/sonner"
import { problem } from "@banda/ui/lib/words"
import type { Listing } from "@banda/ui/module"
import type { Listed } from "@banda/ui/pane"
import { listingOf } from "../registry"

/** What a title says while a model writes one (ADR 0077, decision 3). */
export const THINKING = "Thinking of a title…"

/** Where the field that names a thing is open: in the header of the
 * focused Pane that shows it, or in its row in the sidebar. */
export type Naming = {
  project: ProjectId
  id: string
  where: "head" | "row"
  /** How many times the Person asked the model for a title while it was
   * open (`Shift+F2`): each puts one in the field. */
  asked: number
}

type State = {
  naming: Naming | null
  /** The things a model writes a title for, by `project:id`. */
  thinking: ReadonlySet<string>
}

let state: State = { naming: null, thinking: new Set() }
const heard = new Set<() => void>()

function set(next: State) {
  state = next
  for (const hear of heard) hear()
}

function use<T>(pick: (state: State) => T): T {
  return useSyncExternalStore(
    (hear) => {
      heard.add(hear)
      return () => heard.delete(hear)
    },
    () => pick(state)
  )
}

const keyOf = (project: ProjectId, id: string) => `${project}:${id}`

/** How the window names `listed`; none where its module names nothing. */
export function listingFor(listed: Listed): Listing | undefined {
  return listingOf(listed.pane.kind)
}

/** Opens the field that names `id`, where it shows. */
export function startNaming(
  project: ProjectId,
  id: string,
  where: Naming["where"]
) {
  set({ ...state, naming: { project, id, where, asked: 0 } })
}

/** Closes the field. */
export function stopNaming() {
  if (state.naming) set({ ...state, naming: null })
}

/** Whether the field that names `id` is open: the field, else none. */
export function namingNow(project: ProjectId, id: string): Naming | null {
  const { naming } = state
  return naming?.project === project && naming.id === id ? naming : null
}

/** Asks the model for a title into the open field, as its ✨ does. */
export function askIntoField() {
  const { naming } = state
  if (naming) set({ ...state, naming: { ...naming, asked: naming.asked + 1 } })
}

/** The field that names `id` at `where`, while it is open there. */
export function useNaming(
  project: ProjectId,
  id: string,
  where: Naming["where"]
): Naming | null {
  return use(({ naming }) =>
    naming?.project === project && naming.id === id && naming.where === where
      ? naming
      : null
  )
}

/** Whether a model writes a title for `id` now. */
export function useThinking(project: ProjectId, id: string): boolean {
  return use(({ thinking }) => thinking.has(keyOf(project, id)))
}

function think(key: string, on: boolean) {
  const thinking = new Set(state.thinking)
  if (on) thinking.add(key)
  else thinking.delete(key)
  set({ ...state, thinking })
}

/** A title as the field gives it: one line, its projects trimmed. */
export function cleanTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/**
 * Names `listed` with the field's `text`; an empty field gives back the
 * title it had by itself. What the module refuses, a toast says.
 */
export function renameTo(
  engine: Engine,
  project: ProjectId,
  listed: Listed,
  text: string
): void {
  const title = cleanTitle(text)
  const listing = listingFor(listed)
  if (!listing || title === listed.title) return
  listing
    .rename(engine, project, listed.id, title || null)
    .catch((error: unknown) => toast.error(problem(error)))
}

/** Gives `listed` back the title it had before the last rename. */
export function previousTitle(
  engine: Engine,
  project: ProjectId,
  listed: Listed
) {
  if (listed.was === undefined) return
  renameTo(engine, project, listed, listed.was)
}

/** What a suggestion comes to: a new title, or the one it has. */
export type Suggested = { title: string; same: boolean }

/**
 * Suggest a title, in one press (ADR 0077, decision 3): the module's
 * model writes one while the title shimmers, and the thing is renamed
 * with it. A toast says so, with Undo, which gives back the title before:
 * the one it had by itself, where the Person had not named it. A
 * suggestion the title already says renames nothing.
 */
export async function suggestTitle(
  engine: Engine,
  project: ProjectId,
  listed: Listed
): Promise<void> {
  const listing = listingFor(listed)
  const key = keyOf(project, listed.id)
  if (!listing?.suggest || state.thinking.has(key)) return
  think(key, true)
  try {
    const title = await listing.suggest(engine, project, listed.id)
    if (cleanTitle(title) === listed.title) {
      toast("The title already says it")
      return
    }
    await listing.rename(engine, project, listed.id, title)
    // Never renamed, its title was its own: none brings that back.
    const back = listed.was === undefined ? null : listed.title
    toast(`Renamed to ${title}`, {
      action: {
        label: "Undo",
        onClick: () =>
          void listing
            .rename(engine, project, listed.id, back)
            .catch((error: unknown) => toast.error(problem(error))),
      },
    })
  } catch (error) {
    toast.error(problem(error))
  } finally {
    think(key, false)
  }
}

/** Marks `listed` unread, or read when it is unread now (ADR 0077,
 * decision 6); nothing where it has nothing finished to see. */
export function toggleUnread(listed: Listed) {
  if (listed.seen === undefined) return
  listingFor(listed)?.unread?.(listed.id, listed.seen)
}
