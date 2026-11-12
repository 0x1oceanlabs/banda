/**
 * How the sidebar's search reads the Threads' messages (ADR 0098,
 * decision 17; spec S12c): each machine's engine searches its own
 * Projects' messages (`agents.search`), and says each Thread once, by its
 * best message, with a line of it around the words. The titles are the
 * window's to search.
 */
import type { ListSearch } from "@banda/ui/module"

export const searchThreads: ListSearch = async (session, project, words) =>
  (await session.call("agents.search", { words }, { project })).map(
    ({ thread, snippet, hits, at }) => ({ id: thread, snippet, hits, at })
  )
