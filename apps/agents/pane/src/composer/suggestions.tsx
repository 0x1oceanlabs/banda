/**
 * What the composer suggests for the word being typed: slash commands
 * after `/` at a line's start, files after `@`, skills after `$`. At most
 * one list is open, for the word the editor says is typed, and picking
 * completes that word in the editor.
 */
import { useState } from "react"
import type { Skill } from "@banda/contract/agents"
import type {
  PromptEditorHandle,
  Typing,
} from "@banda/ui/components/prompt-editor"
import { type FindFiles, useFileMenu } from "./FileMenu"
import type { Suggested } from "./slash"
import { useSkillMenu, useSlashMenu } from "./SlashMenu"

export function useSuggestions({
  field,
  text,
  name,
  commands,
  skills,
  findFiles,
  onPlanMode,
}: {
  field: React.RefObject<PromptEditorHandle | null>
  text: string
  /** The Agent's name, for when it has said no slash commands yet. */
  name: string
  commands: Suggested[]
  skills: Skill[]
  findFiles?: FindFiles
  /** Switches plan mode, for the window's own `/plan` and `/default`. */
  onPlanMode: (on: boolean) => void
}) {
  // The word being typed that asks for suggestions: `/`, `@` or `$`.
  const [typing, setTyping] = useState<Typing>()
  const word = (trigger: Typing["trigger"]) =>
    typing?.trigger === trigger ? typing.word : undefined
  const slash = useSlashMenu({
    text,
    word: word("/"),
    commands,
    name,
    onPick: (command) => {
      if (command.planMode === undefined) {
        field.current?.complete(`/${command.name} `)
      } else {
        onPlanMode(command.planMode)
        field.current?.complete("")
      }
    },
  })
  const files = useFileMenu({
    text,
    word: word("@"),
    findFiles,
    onPick: (path) => field.current?.complete({ chip: "file", value: path }),
  })
  const skillMenu = useSkillMenu({
    text,
    word: word("$"),
    skills,
    onPick: (skill) =>
      field.current?.complete({ chip: "skill", value: skill.name }),
  })
  const menus = [slash, files, skillMenu]
  return {
    /** The list open, above the box. */
    menu: (
      <>
        {slash.menu}
        {files.menu}
        {skillMenu.menu}
      </>
    ),
    /** The attributes that tie the editor to the list open. */
    field: Object.assign({}, ...menus.map((menu) => menu.field)) as Record<
      string,
      string | undefined
    >,
    /** The editor's word being typed, as it changes. */
    onTyping: setTyping,
    /** Whether the open list took the key: arrows, Enter, Tab, Escape. */
    onKeyDown: (event: KeyboardEvent) =>
      menus.some((menu) => menu.onKeyDown(event)),
  }
}
