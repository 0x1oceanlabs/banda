/**
 * The commands a message can start with, as the composer suggests them:
 * the Harness's own, and, as in T3 Code, the Thread's `/plan` and
 * `/default`, which switch its plan on and off and send nothing.
 */
import type { Command, Offer } from "@bandaso/contract/agents"

/** A command the composer suggests; with `plan`, one of the Thread's. */
export type Suggested = Command & { plan?: boolean }

const OWN: Suggested[] = [
  { name: "plan", description: "Plan before changing anything", plan: true },
  {
    name: "default",
    description: "Stop planning and do the work",
    plan: false,
  },
]

/** Every command a message in the Thread can start with: the Thread's
 * first, when its Harness can plan, then the Harness's. */
export function suggested(offer: Offer): Suggested[] {
  const own = offer.plans ? OWN : []
  const taken = new Set(own.map((command) => command.name))
  return [
    ...own,
    ...offer.commands.filter((command) => !taken.has(command.name)),
  ]
}

/** The start of a command's name while the message is only that: `/`
 * and a word. A path, with a second `/`, is not one. */
export function typed(text: string): string | undefined {
  return /^\/([^\s/]*)$/.exec(text)?.[1]
}

/** The commands that fit what was typed: by name exactly, then names
 * that start with it, then names and descriptions that hold it. */
export function matching(commands: Suggested[], typed: string): Suggested[] {
  const word = typed.toLowerCase()
  const rank = ({ name, description }: Suggested) => {
    const lower = name.toLowerCase()
    if (lower === word) return 0
    if (lower.startsWith(word)) return 1
    if (lower.includes(word)) return 2
    if (description.toLowerCase().includes(word)) return 3
    return undefined
  }
  return commands
    .flatMap((command, at) => {
      const found = rank(command)
      return found === undefined ? [] : [{ command, at, rank: found }]
    })
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .map((found) => found.command)
}
