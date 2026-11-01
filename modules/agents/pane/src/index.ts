/** The agents module's Panes. */
import { harnessesPane } from "./HarnessesPane"
import { threadPane } from "./ThreadPane"
import { threadsPane } from "./ThreadsPane"

export { harnessesPane, threadPane, threadsPane }
export { NEW_THREAD, type ThreadArgs } from "./ThreadPane"

export const panes = [threadPane, harnessesPane, threadsPane]
