import { useId, useLayoutEffect, useState } from "react"
import {
  Suggestion,
  SuggestionDescription,
  SuggestionList,
  Suggestions,
  SuggestionsEmpty,
  SuggestionTitle,
} from "@bandaso/ui/components/suggestions"
import { matching, type Suggested, typed } from "./slash"

/**
 * The slash commands that fit a message while it is `/` and a word, in a
 * list above its box. The box keeps the focus: arrows move the highlight,
 * Enter or Tab picks, Escape shuts the list until the text changes, and a
 * press on a command picks it.
 *
 * Returns the list to show, the attributes that tie the box to it, and a
 * key handler that says whether it took the key.
 */
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
  const listId = useId()
  // The text Escape shut the list at; any other text opens it again.
  const [shutAt, setShutAt] = useState<string>()
  if (shutAt !== undefined && shutAt !== text) setShutAt(undefined)
  const word = typed(text)
  const open = word !== undefined && shutAt !== text
  const shown = open ? matching(commands, word) : []
  // The highlight follows a command by name, so a list that changes
  // under it keeps it; a new word starts from the first.
  const [highlight, setHighlight] = useState<{ word: string; name: string }>()
  const held =
    highlight !== undefined && highlight.word === word
      ? highlight.name
      : undefined
  const found = shown.findIndex((command) => command.name === held)
  const chosen = shown.length === 0 ? -1 : Math.max(found, 0)
  const optionId = (index: number) => `${listId}-${index}`

  useLayoutEffect(() => {
    if (chosen >= 0)
      document
        .getElementById(`${listId}-${chosen}`)
        ?.scrollIntoView({ block: "nearest" })
  }, [listId, chosen])

  const onKeyDown = (event: React.KeyboardEvent): boolean => {
    if (event.nativeEvent.isComposing || word === undefined) return false
    const plain =
      !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
    if (shown.length > 0 && plain) {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
      if (step !== undefined) {
        const next = shown[(chosen + step + shown.length) % shown.length]
        setHighlight({ word, name: next.name })
        event.preventDefault()
        return true
      }
      if (event.key === "Enter" || event.key === "Tab") {
        onPick(shown[chosen])
        event.preventDefault()
        return true
      }
    }
    if (open && event.key === "Escape") {
      setShutAt(text)
      event.preventDefault()
      return true
    }
    return false
  }

  const menu = open && (
    <Suggestions className="absolute inset-x-0 bottom-full mb-1.5">
      {shown.length > 0 ? (
        <SuggestionList id={listId} aria-label="Slash commands">
          {shown.map((command, index) => (
            <Suggestion
              key={command.name}
              id={optionId(index)}
              selected={index === chosen}
              onMouseMove={() =>
                index !== chosen && setHighlight({ word, name: command.name })
              }
              onClick={() => onPick(command)}
            >
              <SuggestionTitle>/{command.name}</SuggestionTitle>
              <SuggestionDescription>
                {command.description || command.hint}
              </SuggestionDescription>
            </Suggestion>
          ))}
        </SuggestionList>
      ) : (
        <SuggestionsEmpty role="status">
          {commands.length === 0
            ? `No slash commands from ${name} yet.`
            : "No matching slash command."}
        </SuggestionsEmpty>
      )}
    </Suggestions>
  )

  const field = open
    ? {
        "aria-autocomplete": "list" as const,
        "aria-haspopup": "listbox" as const,
        ...(chosen >= 0 && {
          "aria-controls": listId,
          "aria-activedescendant": optionId(chosen),
        }),
      }
    : {}

  return { menu, field, onKeyDown }
}
