import type { Skill } from "@banda/contract/agents"
import { useMenu } from "./Menu"
import { matching, type Suggested } from "./slash"

/** The slash commands that fit `/` and a word at a line's start, in a
 * list above the box, as {@link useMenu} shows one. */
export function useSlashMenu({
  text,
  word,
  commands,
  name,
  onPick,
}: {
  text: string
  /** The command's name being typed, if one is. */
  word: string | undefined
  commands: Suggested[]
  /** The Agent's name, for when it has said no slash commands yet. */
  name: string
  onPick: (command: Suggested) => void
}) {
  return useMenu({
    text,
    word,
    shown: word === undefined ? [] : matching(commands, word),
    label: "Slash commands",
    empty:
      commands.length === 0
        ? `No slash commands from ${name} yet.`
        : "No matching slash command.",
    nameOf: (command) => command.name,
    render: (command) => ({
      title: `/${command.name}`,
      about: command.description || command.hint,
    }),
    onPick,
  })
}

/** The skills that fit `$` and a word at a word's start, in a list above
 * the box, as {@link useMenu} shows one; none while the Harness has said
 * no skills, so `$` is text, as in a price. */
export function useSkillMenu({
  text,
  word,
  skills,
  onPick,
}: {
  text: string
  /** The skill's name being typed, if one is. */
  word: string | undefined
  skills: Skill[]
  onPick: (skill: Skill) => void
}) {
  const asked = skills.length > 0 ? word : undefined
  return useMenu({
    text,
    word: asked,
    shown: asked === undefined ? [] : matching(skills, asked),
    label: "Skills",
    empty: "No matching skill.",
    nameOf: (skill) => skill.name,
    render: (skill) => ({ title: `$${skill.name}`, about: skill.description }),
    onPick,
  })
}
