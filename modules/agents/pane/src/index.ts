/** The agents module's Panes, and its Watch on what calls for the Person. */
import { diffPane } from "./DiffPane"
import { harnessesPane } from "./HarnessesPane"
import { threadPane } from "./ThreadPane"
import { threadsPane } from "./ThreadsPane"
import { threadsWatch } from "./ThreadsWatch"

export { diffPane, harnessesPane, threadPane, threadsPane, threadsWatch }
export { NEW_THREAD, type ThreadArgs } from "./session"
export { useSpaceFiles } from "./FileMenu"
export { useHarnesses } from "./harnesses"

export const panes = [threadPane, harnessesPane, threadsPane, diffPane]
