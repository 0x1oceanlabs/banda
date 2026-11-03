import { useId, useLayoutEffect, useState } from "react"
import {
  Suggestion,
  SuggestionDescription,
  SuggestionList,
  Suggestions,
  SuggestionsEmpty,
  SuggestionTitle,
} from "@banda/ui/components/suggestions"

/**
 * What fits a word typed in the composer, in a list above its box: slash
 * commands, or files. The box keeps the focus: arrows move the highlight,
 * Enter or Tab picks, Escape shuts the list until the text changes, and
 * a press on a choice picks it.
 *
 * Returns the list to show, the attributes that tie the box to it, and a
 * key handler that says whether it took the key.
 */
export function useMenu<T>({
  text,
  word,
  shown,
  label,
  empty,
  nameOf,
  render,
  onPick,
}: {
  /** The whole text: Escape shuts the list until it changes. */
  text: string
  /** The word that opens the list, while one is typed. */
  word: string | undefined
  /** The choices for it. */
  shown: T[]
  /** What the list is, for a screen reader. */
  label: string
  /** What the list says when nothing fits. */
  empty: string
  nameOf: (choice: T) => string
  render: (choice: T) => { title: React.ReactNode; about?: React.ReactNode }
  onPick: (choice: T) => void
}) {
  const listId = useId()
  // The text Escape shut the list at; any other text opens it again.
  const [shutAt, setShutAt] = useState<string>()
  if (shutAt !== undefined && shutAt !== text) setShutAt(undefined)
  const open = word !== undefined && shutAt !== text
  const choices = open ? shown : []
  // The highlight follows a choice by name, so a list that changes under
  // it keeps it; a new word starts from the first.
  const [highlight, setHighlight] = useState<{ word: string; name: string }>()
  const held =
    highlight !== undefined && highlight.word === word
      ? highlight.name
      : undefined
  const found = choices.findIndex((choice) => nameOf(choice) === held)
  const chosen = choices.length === 0 ? -1 : Math.max(found, 0)
  const optionId = (index: number) => `${listId}-${index}`

  useLayoutEffect(() => {
    if (chosen >= 0)
      document
        .getElementById(`${listId}-${chosen}`)
        ?.scrollIntoView({ block: "nearest" })
  }, [listId, chosen])

  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (event.isComposing || word === undefined) return false
    const plain =
      !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
    if (choices.length > 0 && plain) {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
      if (step !== undefined) {
        const next = choices[(chosen + step + choices.length) % choices.length]
        setHighlight({ word, name: nameOf(next) })
        event.preventDefault()
        return true
      }
      if (event.key === "Enter" || event.key === "Tab") {
        onPick(choices[chosen])
        event.preventDefault()
        return true
      }
    }
    if (open && event.key === "Escape") {
      setShutAt(text)
      event.preventDefault()
      // Its own: not the drawer's, nor anything around it.
      event.stopPropagation()
      return true
    }
    return false
  }

  const menu = open && (
    <Suggestions className="absolute inset-x-0 bottom-full mb-1.5">
      {choices.length > 0 ? (
        <SuggestionList id={listId} aria-label={label}>
          {choices.map((choice, index) => {
            const { title, about } = render(choice)
            return (
              <Suggestion
                key={nameOf(choice)}
                id={optionId(index)}
                selected={index === chosen}
                onMouseMove={() =>
                  index !== chosen &&
                  setHighlight({ word, name: nameOf(choice) })
                }
                onClick={() => onPick(choice)}
              >
                <SuggestionTitle>{title}</SuggestionTitle>
                {about && (
                  <SuggestionDescription>{about}</SuggestionDescription>
                )}
              </Suggestion>
            )
          })}
        </SuggestionList>
      ) : (
        <SuggestionsEmpty role="status">{empty}</SuggestionsEmpty>
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
