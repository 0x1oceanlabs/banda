/**
 * The Question to start a Crew (ADR 0103, decision 30; mock 02, A):
 * Claude's own permission for its Workflow call, built from the script's
 * `meta`: its title and description, its phases with what each does, and
 * a note of what it costs. Its answers are Claude's, each with its key:
 * 1 Start, Claude's "don't ask again" kept as it offers it (amended
 * 2026-11-12), and `Esc` No. View script shows the script in place.
 */
import { useState } from "react"
import { UsersIcon } from "lucide-react"
import type { Choice, CrewStart } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import { cn } from "@banda/ui/lib/utils"
import { CrewGlyph } from "../entries/crew"
import { answersOf, plain } from "./asking"
import { KeyHint } from "./QuestionForm"
import type { Answer } from "./Questions"
import { START_NOTE } from "../thread/crew"

export function CrewStartBody({
  start,
  choices,
  answering,
  onAnswer,
}: {
  start: CrewStart
  choices: Choice[]
  answering: boolean
  onAnswer: Answer
}) {
  const [script, setScript] = useState(false)
  const { title } = start
  const description = start.description?.trim()
  const { decline, main, others, kept } = answersOf(choices)
  const number = (choice: Choice) => String(choices.indexOf(choice) + 1)
  const row = (choice: Choice, name: string, key: string, enter = false) => (
    <Button
      key={choice.id}
      variant="outline"
      size="sm"
      aria-keyshortcuts={
        key === "Esc" ? "Escape" : enter ? `${key} Enter` : key
      }
      disabled={answering}
      onClick={() => onAnswer(choice.id)}
      className={cn("w-full justify-start gap-2 pl-1.5", enter && "pr-1.5")}
    >
      <KeyHint>{key}</KeyHint>
      <span className="min-w-0 flex-1 truncate text-left">{name}</span>
      {enter && <KeyHint>⏎</KeyHint>}
    </Button>
  )
  return (
    <div data-slot="crew-start" className="flex min-w-0 flex-col gap-2 pt-1">
      <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
        <CrewGlyph state="working" />
        <span className="shrink-0 font-[550]">{title}</span>
        {description && (
          <span className="min-w-0 truncate text-meta text-muted-foreground">
            {description}
          </span>
        )}
      </div>
      {start.phases.length > 0 && (
        <ol className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 text-meta">
          {start.phases.map((phase) => (
            <li key={phase.index} className="flex items-baseline gap-1.5">
              <span className="text-sub-faint tabular-nums">{phase.index}</span>
              <span className="font-medium text-foreground">{phase.title}</span>
              {phase.detail && (
                <span className="text-muted-foreground">{phase.detail}</span>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
        <UsersIcon aria-hidden className="size-3 shrink-0 text-sub-faint" />
        {START_NOTE}
      </p>
      {script && (
        <pre
          data-slot="crew-script"
          className="max-h-48 overflow-auto rounded-control bg-raised px-3 py-2 font-mono text-code whitespace-pre-wrap"
        >
          {start.script}
        </pre>
      )}
      <div className="mt-1 flex flex-col gap-1.5">
        {main && row(main, "Start", number(main), true)}
        {[...others, ...kept].map((choice) =>
          row(choice, plain(choice.name), number(choice))
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={script}
          className="w-full justify-start pl-1.5 text-muted-foreground"
          onClick={() => setScript(!script)}
        >
          {script ? "Hide script" : "View script"}
        </Button>
        {decline && row(decline, plain(decline.name), "Esc")}
      </div>
    </div>
  )
}
