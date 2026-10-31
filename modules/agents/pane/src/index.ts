/** The agents module's Panes. */
import { agentsPane } from "./AgentsPane"
import { threadPane } from "./ThreadPane"

export { agentsPane, threadPane }
export type { ThreadArgs } from "./ThreadPane"

export const panes = [agentsPane, threadPane]
