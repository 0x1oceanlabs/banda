/**
 * The ids of the Tiling's widgets on the Bar, as the look's `[bar]` names
 * them (ADR 0064): a file of their own, so what places the widgets reads
 * them without drawing any.
 */

/** The workspaces, a widget the window always has (ADR 0064, decision 2). */
export const WORKSPACES = "workspaces.list"

/** The workspaces set aside, while they are (ADR 0039, decision 2). */
export const ASIDE = "workspaces.aside"
