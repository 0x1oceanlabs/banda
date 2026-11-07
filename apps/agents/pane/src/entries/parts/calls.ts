/**
 * A tool call as its line in the Thread says it (ADR 0058, decision 4):
 * the verb in the past tense once it ended, as it goes while it runs, as
 * it was asked while it waits; what it acted on; and how it ended. Pure,
 * so plain tests cover it.
 */
import type { TurnState } from "@banda/contract/agents"
import type { Tool } from "../../thread/state"

/** How a call stands, as its line shows it. */
export type Outcome =
  /** It waits for its Person to allow it. */
  | "waiting"
  | "running"
  | "done"
  | "failed"
  /** Something stopped it: its Person, or a signal. */
  | "stopped"

/**
 * How `tool` stands in a turn that is `turn`, if that is known. A command
 * that ended with another code than 0 failed; one a signal ended, or that
 * failed when its Person stopped the turn, was stopped. A call still open
 * in a turn that ended went as far as the turn did. `asks`: a Question of
 * its turn is open, and it is the call that waits on it.
 */
export function outcome(tool: Tool, turn?: TurnState, asks = false): Outcome {
  if (tool.status === "pending" || tool.status === "running") {
    if (turn === undefined || turn === "running" || turn === "queued")
      return asks && tool.status === "pending" ? "waiting" : "running"
    return turn === "done" ? "done" : "stopped"
  }
  const exit = tool.output?.exit
  if (exit?.code !== undefined && exit.code !== 0) return "failed"
  if (exit?.signal !== undefined) return "stopped"
  if (tool.status === "failed")
    return turn === "stopped" && exit?.code === undefined ? "stopped" : "failed"
  return "done"
}

/** What a call's line says: its verb, quiet, and what it acted on. */
export type Said = { verb?: string; subject: string }

/** A verb as a call is asked, as it goes and once it is done. */
type Verb = { ask: string; going: string; did: string }

const verb = (ask: string, going: string, did: string): Verb => ({
  ask,
  going,
  did,
})

const RUN = verb("Run", "Running", "Ran")
const SEARCH = verb("Search for", "Searching for", "Searched for")
const CREATE = verb("Create", "Creating", "Created")

/** The verbs a Harness starts a title with, by each form of them. */
const VERBS: ReadonlyMap<string, Verb> = new Map(
  [
    RUN,
    verb("Read", "Reading", "Read"),
    verb("View", "Viewing", "Viewed"),
    verb("Open", "Opening", "Opened"),
    verb("List", "Listing", "Listed"),
    verb("Edit", "Editing", "Edited"),
    verb("Write", "Writing", "Wrote"),
    CREATE,
    verb("Update", "Updating", "Updated"),
    verb("Apply", "Applying", "Applied"),
    verb("Delete", "Deleting", "Deleted"),
    verb("Remove", "Removing", "Removed"),
    verb("Move", "Moving", "Moved"),
    verb("Rename", "Renaming", "Renamed"),
    SEARCH,
    verb("Fetch", "Fetching", "Fetched"),
    verb("Think", "Thinking", "Thought"),
    verb("Use", "Using", "Used"),
  ].flatMap((one) => {
    const forms = [one.ask, one.going, one.did].map(
      (form) => form.split(" ")[0]
    )
    return forms.map((form) => [form.toLowerCase(), one] as const)
  })
).set("find", SEARCH)

/**
 * What `tool`'s line says, from the title its Harness gave it: "Ran pnpm
 * test" once it is done, "Running pnpm test" while it runs, "Run pnpm
 * test" while it waits. A command's title is the command, so it runs; a
 * title that starts with no verb Banda knows says itself.
 */
export function said(tool: Tool, now: Outcome): Said {
  const title = tool.title.trim()
  const [, first = "", rest = ""] = /^(\S+)(?:\s+([\s\S]+))?$/.exec(title) ?? []
  const known = VERBS.get(first.toLowerCase())
  // A command could start with a word like "find": only "Run" leads one.
  const lead =
    tool.tool === "execute" ? (known === RUN ? RUN : undefined) : known
  const subject = bare(lead ? rest : title)
  const which = lead ?? (tool.tool === "execute" ? RUN : undefined)
  if (!which) return { subject }
  const made =
    madeFiles(tool) && (which.ask === "Write" || which.ask === "Edit")
  const words = made ? CREATE : which
  const form =
    now === "running" ? words.going : now === "waiting" ? words.ask : words.did
  // "Searched for for x" says the word twice.
  if (words === SEARCH && /^for\s/i.test(subject))
    return { verb: form.split(" ")[0], subject }
  return { verb: form, subject }
}

/** Whether every file the call changed is one it made. */
function madeFiles(tool: Tool): boolean {
  const diffs = tool.content.filter((part) => part.kind === "diff")
  return diffs.length > 0 && diffs.every((diff) => diff.old === undefined)
}

/** `text` without the backticks a Harness may wrap it in. */
function bare(text: string): string {
  const quoted = /^`([^`]+)`$/.exec(text)
  return quoted ? quoted[1] : text
}
