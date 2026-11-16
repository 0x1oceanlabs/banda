/** How a control of an App's screen opens another of the App's views
 * in the screen's place. */
import { createContext } from "react"

/** Opens the App's view `view` with `params`; the Pane keeps the way
 * back. None where a Tree is drawn with no Pane around it. */
export type Opens = (view: string, params: Record<string, unknown>) => void

export const Opening = createContext<Opens | undefined>(undefined)
