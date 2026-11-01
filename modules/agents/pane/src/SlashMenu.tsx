import { useMenu } from "./Menu"
import { matching, type Suggested, typed } from "./slash"

/** The slash commands that fit a message while it is `/` and a word, in
 * a list above its box, as {@link useMenu} shows one. */
export function useSlashMenu({
  text,
  commands,
  name,
  onPick,
}: {
  text: string
  commands: Suggested[]
  /** The Agent's name, for when it has said no slash commands yet. */
  name: string
  onPick: (command: Suggested) => void
}) {
  const word = typed(text)
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
