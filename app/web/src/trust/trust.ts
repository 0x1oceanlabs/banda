/**
 * A Project's trust in the window's words (ADR 0083, decision 5; ADR
 * 0084, decision 13): why a folder looks foreign, as Add Project asks
 * about it, and what of it waits until the Person trusts it. Plain data,
 * so the menu, the sidebar and the settings only draw it.
 */
import type { Foreign } from "@banda/contract"

/** What the engine finds that is a folder, which a path shows with its
 * slash. */
const FOLDERS = [".claude", ".codex", ".devcontainer"]

/** What a Harness loads from a folder, by the name the engine finds, and
 * what it holds for it. */
const LOADED: Record<string, string> = {
  ".claude": "Claude Code's settings and hooks",
  ".codex": "Codex's settings",
  ".mcp.json": "MCP servers",
}

/** What a folder holds that waits for trust: a row of the list. */
export type Waiting = { name: string; holds: string }

/** Why a folder looks foreign, as the question shows it. */
export type Asked = {
  /** The quiet line over the question: where the code comes from, and
   * what it has; none when the folder does not look foreign. */
  line?: string
  /** Whether the line says where the code comes from, or only what the
   * folder has. */
  from: boolean
  /** What its Harnesses load only once it is trusted. */
  waits: Waiting[]
  /** It was cloned from a URL: running it isolated will be on (ADR 0084,
   * decision 13). */
  cloned: boolean
}

/** Why `foreign` says a folder looks foreign, in the question's words. */
export function askedOf(foreign: Foreign): Asked {
  const from: string[] = []
  const has: string[] = []
  const waits: Waiting[] = []
  for (const why of foreign.why)
    switch (why.kind) {
      case "cloned":
        from.push(`Cloned from ${why.from}`)
        break
      case "remote":
        from.push(
          `its remote ${why.remote} is ${why.at}, whose owner is not you`
        )
        break
      case "holds": {
        const name = FOLDERS.includes(why.name) ? `${why.name}/` : why.name
        has.push(name)
        const holds = LOADED[why.name]
        if (holds) waits.push({ name, holds })
      }
    }
  if (has.length > 0) from.push(`it has ${spoken(has)}`)
  const line = from.join(" · ")
  return {
    ...(line && { line: line[0].toUpperCase() + line.slice(1) }),
    from: foreign.why.some((why) => why.kind !== "holds"),
    waits,
    cloned: foreign.why.some((why) => why.kind === "cloned"),
  }
}

/** Names as a sentence says them: "a, b and c". */
function spoken(names: readonly string[]): string {
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}

/** What Add Project asks of a folder that looks foreign. */
export const ASK = "Code you didn't write?"

/** What the question says waits, over the list of it. */
export const ASK_ABOUT =
  "Until you trust it, Claude Code and Codex here read only your own settings. These wait:"

/** What waits in a Project that holds none of it yet. */
export const NOTHING_YET =
  "Its own .claude/, .codex/ and .mcp.json, once it has them."

/** The question's two answers, Not yet first, as Enter takes it. */
export const ANSWERS = {
  notYet: {
    title: "Not yet",
    about: "Add it now. Trust it later in Project settings.",
  },
  trust: {
    title: "Trust",
    about: "Its settings, hooks and MCP servers load.",
  },
} as const

/** Running a Project isolated, which is not built yet (ADR 0084). */
export const ISOLATED = {
  title: "Run it isolated",
  about: "Agents, terminals and its scripts run in a container.",
  cloned: "On for a clone from a URL.",
  /** As the Project's settings say it. */
  setting: "Isolated",
  settingAbout:
    "Agents, terminals and this Project's scripts run in a container. Your files stay where they are.",
}

/** What the Project's settings say of its trust. */
export function trustAbout(trusted: boolean): string {
  return trusted
    ? "Trusted. Claude Code and Codex load its own settings, hooks and MCP servers, from their next turn."
    : "Not trusted. Claude Code and Codex read only your own settings here; its .claude/, .codex/ and .mcp.json wait."
}
