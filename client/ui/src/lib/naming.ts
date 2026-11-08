/**
 * The Person names an Item, as a Thread (ADR 0077): where its field is
 * open, what the model offers into it, and which titles a model is
 * writing now. The Window draws the field and the title; the Item's App,
 * whose item actions rename it and suggest a title (ADR 0087, decision
 * 12), opens the field and offers it a title through this.
 */
import { useSyncExternalStore } from "react"
import type { ProjectId } from "@banda/contract"

/** What a title says while a model writes one (ADR 0077, decision 3). */
export const THINKING = "Thinking of a title…"

/** Where the field that names an Item is open: in the header of the
 * focused Pane that shows it, or in its row in the sidebar. */
export type Naming = {
  project: ProjectId
  id: string
  where: "head" | "row"
  /** The model writes a title for the field now, as its ✨ or `Shift+F2`
   * asked. */
  asking: boolean
  /** The title the model offered last, and how many it offered: each
   * goes in the field, selected. */
  offered?: { title: string; n: number }
}

type State = {
  naming: Naming | null
  /** The Items a model writes a title for, by `project:id`. */
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

/** Opens the field that names `id`, where it shows. */
export function startNaming(
  project: ProjectId,
  id: string,
  where: Naming["where"]
) {
  set({ ...state, naming: { project, id, where, asking: false } })
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

/** Says the model writes a title for the open field of `id`, or no
 * longer does; nothing when that field is not open. */
export function asking(project: ProjectId, id: string, on: boolean) {
  const naming = namingNow(project, id)
  if (naming && naming.asking !== on)
    set({ ...state, naming: { ...naming, asking: on } })
}

/** Puts `title` in the open field of `id`, as its ✨ does; nothing once
 * that field has closed. */
export function offer(project: ProjectId, id: string, title: string) {
  const naming = namingNow(project, id)
  if (!naming) return
  const n = (naming.offered?.n ?? 0) + 1
  set({ ...state, naming: { ...naming, offered: { title, n } } })
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

/** Whether a model writes a title for `id` now, as an act asks it. */
export function thinkingNow(project: ProjectId, id: string): boolean {
  return state.thinking.has(keyOf(project, id))
}

/** Says a model writes a title for `id` now, which shimmers where it
 * shows, or no longer does. */
export function think(project: ProjectId, id: string, on: boolean) {
  const key = keyOf(project, id)
  if (state.thinking.has(key) === on) return
  const thinking = new Set(state.thinking)
  if (on) thinking.add(key)
  else thinking.delete(key)
  set({ ...state, thinking })
}

/** A title as the field gives it: one line, its ends trimmed. */
export function cleanTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}
