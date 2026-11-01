/** The agents module's Panes. */
import { agentsPane } from "./AgentsPane"
import { harnessesPane } from "./HarnessesPane"
import { threadPane } from "./ThreadPane"

export { agentsPane, harnessesPane, threadPane }
export type { ThreadArgs } from "./ThreadPane"

export const panes = [agentsPane, threadPane, harnessesPane]
