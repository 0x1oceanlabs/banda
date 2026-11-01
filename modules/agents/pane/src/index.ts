/** The agents module's Panes, and its Watch on what calls for the Person. */
import { harnessesPane } from "./HarnessesPane"
import { threadPane } from "./ThreadPane"
import { threadsPane } from "./ThreadsPane"
import { threadsWatch } from "./ThreadsWatch"

export { harnessesPane, threadPane, threadsPane, threadsWatch }
export { NEW_THREAD, type ThreadArgs } from "./ThreadPane"

export const panes = [threadPane, harnessesPane, threadsPane]
