/**
 * Slots (ADR 0082, decision 8; ADR 0087, decision 5): places in one App's
 * thing that other Apps fill, as a file manager asks a provider for a
 * column. A module says in its `slots` what it puts in each, and draws it
 * there with the props the Slot gives; the Slot's owner reads who fills
 * it in one place (`useSlot`) and draws them in the modules' order. Two
 * in v1: a Thread's details card, Threads', which Git fills, and a Pane's
 * header, the Tiling's, which Threads fills with a Thread's Mark and the
 * Window with another machine's name and icon. Code, until an App's view
 * answers a Tree (V2).
 */
import type { ProjectId } from "@banda/contract"
import { type ComponentType, createContext, useContext } from "react"
import type { DetailsProps } from "./components/thread-details"
import type { Listed, PaneState } from "./pane"

/**
 * What a Pane's header gives what fills it (ADR 0062, decision 17): the
 * Pane, the Item it shows, and where in the header it is drawn. Each
 * draws what it shows of the Pane there, or nothing.
 */
export type HeaderProps = {
  project: ProjectId
  pane: PaneState
  /** The Item the Pane shows, as its App lists it; none for a Pane that
   * shows none. */
  listed: Listed | undefined
} & (
  | {
      /** At the header's start, in the icon's place of a Pane that shows
       * an Item; or after the Project's name, where the header says where
       * the Pane is, at its end when it names no Project; or in the pill,
       * which is drawn over the Pane's body, not in its header, while the
       * Pane cannot reach the machine it is on: away, stopped or still
       * connecting (ADR 0095, decision 7). A filler draws nothing at a
       * place it does not know. */
      at: "start" | "project" | "pill"
    }
  | {
      /** On the Pane's tile in the Overview, at a size to read. */
      at: "overview"
      /** The Item calls the Person now, as the tile's ring says. */
      calling: boolean
    }
)

/** Each Slot by its name, with the props it gives what fills it. */
export type SlotProps = {
  /** A Thread's details card (ADR 0034, decision 4): Threads'. */
  "thread.details": DetailsProps
  /** A Pane's header, the pill over its body, and its tile's label in
   * the Overview: the Tiling's. */
  "pane.header": HeaderProps
}

export type Slot = keyof SlotProps

/** What a module puts in a Slot: drawn there with the Slot's props, after
 * what the modules before it put there. */
export type Filler<S extends Slot = Slot> = {
  [K in S]: {
    /** Dotted, its module's id first: `git.branch`. */
    id: string
    slot: K
    Fill: ComponentType<SlotProps[K]>
  }
}[S]

/** What fills each Slot: the modules that run, in their order. A Slot
 * no module fills has none. */
export type Fillers = { readonly [S in Slot]?: readonly Filler<S>[] }

/** What fills each Slot, as the Window gives it to what it draws; none
 * where no Window gives it, as in a test. */
export const Slots = createContext<Fillers>({})

const NONE: readonly never[] = []

/** What fills `slot`, in order: what its owner draws there. */
export function useSlot<S extends Slot>(slot: S): readonly Filler<S>[] {
  return useContext(Slots)[slot] ?? NONE
}
