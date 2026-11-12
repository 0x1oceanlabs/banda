/**
 * shadcn's Questionnaire (2026-08) in the Banda look: one question at a
 * time, its choices as rows with their keys, the Person's own words as the
 * last row of the same list (docs/design/README.md, #1513). The headless
 * part, `@shadcn/react/questionnaire`, keeps the keys: 1–9 pick, ↑↓ move
 * between answers, Enter goes on. Who shows it says what Next, Skip and
 * Submit do, so its buttons are the caller's.
 */
import * as React from "react"
import { Questionnaire as QuestionnairePrimitive } from "@shadcn/react/questionnaire"
import { CheckIcon } from "lucide-react"

import { Kbd } from "@banda/ui/components/kbd"
import { cn } from "@banda/ui/lib/utils"

function Questionnaire({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Root>) {
  return (
    <QuestionnairePrimitive.Root
      data-slot="questionnaire"
      className={cn("flex w-full min-w-0 flex-col gap-3", className)}
      {...props}
    />
  )
}

function QuestionnaireItem({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Item>) {
  return (
    <QuestionnairePrimitive.Item
      data-slot="questionnaire-item"
      className={cn(
        "flex min-w-0 flex-col gap-2 border-0 p-0 outline-none",
        className
      )}
      {...props}
    />
  )
}

function QuestionnaireTitle({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Title>) {
  return (
    <QuestionnairePrimitive.Title
      data-slot="questionnaire-title"
      className={cn(
        "p-0 text-ui font-[550] text-pretty wrap-break-word",
        className
      )}
      {...props}
    />
  )
}

function QuestionnaireDescription({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Description>) {
  return (
    <QuestionnairePrimitive.Description
      data-slot="questionnaire-description"
      className={cn(
        "-mt-1 text-meta text-pretty text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function QuestionnaireChoices({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Choices>) {
  return (
    <QuestionnairePrimitive.Choices
      data-slot="questionnaire-choices"
      className={cn(
        "group/questionnaire-choices grid min-w-0 gap-1",
        className
      )}
      {...props}
    />
  )
}

/** A choice: a row with its mark, its name and its key. The one picked
 * takes the selection's blue, as a list's does. */
function QuestionnaireChoice({
  children,
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Choice>) {
  return (
    <QuestionnairePrimitive.Choice
      data-slot="questionnaire-choice"
      className={cn(
        "group/questionnaire-choice relative flex min-h-9 cursor-pointer items-start gap-2.5 rounded-control border border-border px-2.5 py-1.5 text-start text-ui transition-colors outline-none select-none hover:bg-muted/60",
        "has-[>input:focus-visible]:border-ring has-[>input:focus-visible]:ring-2 has-[>input:focus-visible]:ring-ring/25 data-invalid:border-destructive data-checked:border-ring/45 data-checked:bg-ring/12",
        "data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <QuestionnairePrimitive.ChoiceInput
        data-slot="questionnaire-choice-input"
        className="absolute inset-0 z-raised size-full cursor-pointer opacity-0"
      />
      <span
        aria-hidden="true"
        data-slot="questionnaire-choice-indicator"
        className="pointer-events-none relative flex size-4 shrink-0 translate-y-0.5 items-center justify-center rounded-small border border-input group-data-[type=radio]/questionnaire-choice:rounded-full group-data-checked/questionnaire-choice:border-ring group-data-checked/questionnaire-choice:bg-ring group-data-checked/questionnaire-choice:text-background"
      >
        <span
          data-slot="questionnaire-choice-indicator-dot"
          className="hidden size-1.5 rounded-full bg-background group-data-[type=checkbox]/questionnaire-choice:hidden group-data-checked/questionnaire-choice:block"
        />
        <CheckIcon
          data-slot="questionnaire-choice-indicator-check"
          className="hidden size-3 group-data-[type=radio]/questionnaire-choice:hidden group-data-checked/questionnaire-choice:block"
        />
      </span>
      <QuestionnairePrimitive.ChoiceLabel
        data-slot="questionnaire-choice-label"
        className="flex min-w-0 flex-1 flex-col wrap-break-word"
      >
        {children}
      </QuestionnairePrimitive.ChoiceLabel>
      <QuestionnairePrimitive.ChoiceShortcut
        data-slot="questionnaire-choice-shortcut"
        render={
          <Kbd className="ms-auto hidden group-data-[shortcut]/questionnaire-choice:inline-flex" />
        }
      />
    </QuestionnairePrimitive.Choice>
  )
}

function QuestionnaireChoiceDescription({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="questionnaire-choice-description"
      className={cn("text-meta text-muted-foreground", className)}
      {...props}
    />
  )
}

/** The Person's own words, as the last row of the choices: its key shows
 * until it holds the focus. */
function QuestionnaireInput({
  className,
  shortcut,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Input> & {
  shortcut?: string
}) {
  return (
    <div
      data-slot="questionnaire-input-wrapper"
      className="group/questionnaire-input relative w-full min-w-0"
    >
      <QuestionnairePrimitive.Input
        data-slot="questionnaire-input"
        className={cn(
          "h-9 w-full min-w-0 rounded-control border border-border bg-transparent px-2.5 text-ui transition-[color,box-shadow,background-color] outline-none placeholder:text-muted-foreground hover:bg-muted/60 focus-visible:border-ring focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive data-filled:border-ring/45 data-filled:bg-ring/12",
          shortcut && "pr-9",
          className
        )}
        {...props}
      />
      {shortcut && (
        <Kbd
          aria-hidden="true"
          className="absolute top-2 right-2.5 group-focus-within/questionnaire-input:hidden"
        >
          {shortcut}
        </Kbd>
      )}
    </div>
  )
}

function QuestionnaireError({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Error>) {
  return (
    <QuestionnairePrimitive.Error
      data-slot="questionnaire-error"
      className={cn("text-meta text-destructive", className)}
      {...props}
    />
  )
}

export {
  Questionnaire,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireTitle,
}
