/**
 * The slash commands a message can start with, as the composer suggests
 * them: the Harness's, and, as in T3 Code, the window's own `/plan` and
 * `/default`, which switch plan mode and send nothing.
 */
import type { Offer, SlashCommand } from "@bandaso/contract/agents"

/** A slash command the composer suggests. One of the window's own names
 * the plan mode it switches to. */
export type Suggested = SlashCommand & { planMode?: boolean }

const OWN: Suggested[] = [
  {
    name: "plan",
    description: "Plan before changing anything",
    planMode: true,
  },
  {
    name: "default",
    description: "Stop planning and do the work",
    planMode: false,
  },
]

/** Every slash command a message in the Thread can start with: the
 * window's own first, when the Harness can plan, then the Harness's. One
 * of the Harness's named as one of the window's is left out. */
export function suggested(offer: Offer): Suggested[] {
  const own = offer.plans ? OWN : []
  const taken = new Set(own.map((command) => command.name))
  return [
    ...own,
    ...offer.slash_commands.filter((command) => !taken.has(command.name)),
  ]
}

/** The start of a slash command's name while the message is only that:
 * `/` and a word. A path, with a second `/`, is not one. */
export function typed(text: string): string | undefined {
  return /^\/([^\s/]*)$/.exec(text)?.[1]
}

/** The window's own slash command that a whole message is, as `/plan`:
 * it is not sent, but switches plan mode. */
export function ownCommand(
  text: string,
  commands: Suggested[]
): Suggested | undefined {
  const name = /^\/(\S+)$/.exec(text.trim())?.[1]
  return commands.find(
    (command) => command.planMode !== undefined && command.name === name
  )
}

/** The slash commands that fit a word: by name exactly, then names that
 * start with it, then names and descriptions that hold it. */
export function matching(commands: Suggested[], word: string): Suggested[] {
  const lower = word.toLowerCase()
  const rank = ({ name, description }: Suggested) => {
    const named = name.toLowerCase()
    if (named === lower) return 0
    if (named.startsWith(lower)) return 1
    if (named.includes(lower)) return 2
    if (description.toLowerCase().includes(lower)) return 3
    return undefined
  }
  return commands
    .flatMap((command, order) => {
      const found = rank(command)
      return found === undefined ? [] : [{ command, order, rank: found }]
    })
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((found) => found.command)
}
