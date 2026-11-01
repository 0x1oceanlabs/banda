/** The agents module's Panes. */
import { agentsPane } from "./AgentsPane"
import { harnessesPane } from "./HarnessesPane"
import { threadPane } from "./ThreadPane"
import { threadsPane } from "./ThreadsPane"

export { agentsPane, harnessesPane, threadPane, threadsPane }
export type { ThreadArgs } from "./ThreadPane"

export const panes = [agentsPane, threadPane, harnessesPane, threadsPane]
