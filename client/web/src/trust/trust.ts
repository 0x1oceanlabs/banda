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

/** What a folder holds that waits for trust, a row of the list: a folder
 * of settings, or a file of MCP servers. */
export type Waiting = { name: string; holds: string; kind: "folder" | "file" }

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
  let cloned = false
  for (const why of foreign.why)
    switch (why.kind) {
      case "cloned":
        cloned = true
        from.push(`Cloned from ${why.from}`)
        break
      case "remote":
        from.push(
          `its remote ${why.remote} is ${why.at}, whose owner is not you`
        )
        break
      case "holds": {
        const folder = FOLDERS.includes(why.name)
        const name = folder ? `${why.name}/` : why.name
        has.push(name)
        const holds = LOADED[why.name]
        if (holds) waits.push({ name, holds, kind: folder ? "folder" : "file" })
      }
    }
  const said = from.length > 0
  if (has.length > 0) from.push(`it has ${spoken(has)}`)
  const line = from.join(" · ")
  return {
    ...(line && { line: line[0].toUpperCase() + line.slice(1) }),
    from: said,
    waits,
    cloned,
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

/** What the card says when the engine could not look in the folder, so
 * it lists nothing; why follows. */
export const UNSEEN = "Banda couldn't look in its folder."

/** What waits in a Project that holds none of it yet. */
export const NOTHING_YET =
  "Its own .claude/, .codex/ and .mcp.json, once it has them."

/** What trusting a Project also gives its Agents (ADR 0083): only a
 * Project the Person said they trust does, as they add it or later. */
export const GITHUB_TOKEN = "Its Agents also get your GitHub token."

/** The question's two answers, Not yet first, as Enter takes it. */
export const ANSWERS = {
  notYet: {
    title: "Not yet",
    about: "Add it now. Trust it later in Project settings.",
  },
  trust: {
    title: "Trust",
    about: `Its settings, hooks and MCP servers load. ${GITHUB_TOKEN}`,
  },
} as const

/** One of the question's answers. */
export type Answer = (typeof ANSWERS)[keyof typeof ANSWERS]

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

/** What the Project's settings say of its trust: whether it is trusted,
 * and where the fence holds (`fenced`), whether the Person said so, which
 * gives its Agents their GitHub token. Elsewhere they act as the Person,
 * and `gh` reaches the token itself. */
export function trustAbout(
  project: { trusted: boolean; trust_said?: boolean },
  fenced: boolean
): string {
  if (!project.trusted)
    return "Not trusted. Claude Code and Codex read only your own settings here; its .claude/, .codex/ and .mcp.json wait."
  const loads =
    "Trusted. Claude Code and Codex load its own settings, hooks and MCP servers, from their next turn."
  if (!fenced) return loads
  return project.trust_said
    ? `${loads} ${GITHUB_TOKEN}`
    : "Trusted, as nothing marked it foreign: its settings, hooks and MCP servers load. Its Agents get your GitHub token once you say you trust it."
}

/** Whether a trusted Project's settings offer to say it is trusted: only
 * where the fence holds, as only there does saying it give its Agents
 * the GitHub token. */
export function offersSaying(
  project: { trusted: boolean; trust_said?: boolean },
  fenced: boolean
): boolean {
  return fenced && project.trusted && !project.trust_said
}
