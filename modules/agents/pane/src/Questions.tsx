import { Fragment, useState } from "react"
import { Button } from "@bandaso/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bandaso/ui/components/dropdown-menu"
import {
  Trace,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@bandaso/ui/components/trace"
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ShieldQuestionIcon,
} from "lucide-react"
import { Card } from "./Card"
import { summary, type Values } from "./form"
import { QuestionForm } from "./QuestionForm"
import type { Asked, QuestionBody } from "./thread"

/** How a Question is answered: with one of its choices, and what its form
 * holds. */
export type Answer = (choice: string, values?: Values) => void

/**
 * A Question in the Thread (ADR 0010, decision 5). One with choices only
 * asks right there: its choices as buttons, the first that allows the
 * main one, the answers the Harness keeps for next time under More. One
 * with a form is answered in the drawer on the composer, so here it only
 * says it waits. Answered, it says what the Person chose.
 */
export function Question({
  question,
  answering,
  onAnswer,
}: {
  question: QuestionBody
  answering: boolean
  onAnswer: Answer
}) {
  const { title, choices, form, state } = question
  if (state === "open" && form)
    return (
      <Trace>
        <TraceLine status="pending">
          <TraceIcon>
            <ShieldQuestionIcon />
          </TraceIcon>
          <TraceTitle className="whitespace-normal">
            {`Waiting for your answer: ${title}`}
          </TraceTitle>
        </TraceLine>
      </Trace>
    )
  return (
    <Card icon={<ShieldQuestionIcon />} title={title}>
      {state === "open" ? (
        <Choices choices={choices} answering={answering} onAnswer={onAnswer} />
      ) : (
        <Answered question={question} />
      )}
    </Card>
  )
}

/** The answers, as T3 Code shows an approval: the main ones as buttons, the
 * ones the Harness keeps for next time under More. */
function Choices({
  choices,
  answering,
  onAnswer,
}: {
  choices: QuestionBody["choices"]
  answering: boolean
  onAnswer: Answer
}) {
  const once = choices.filter((choice) => !choice.always)
  const kept = choices.filter((choice) => choice.always)
  const main = once.find((choice) => choice.allows)
  // The main answer sits last, where the eye ends: Decline · Approve.
  const shown = main ? [...once.filter((c) => c !== main), main] : once
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="mr-auto text-xs text-muted-foreground">
        Waiting for you
      </span>
      {shown.map((choice) => (
        <Button
          key={choice.id}
          size="sm"
          variant={choice === main ? "default" : "outline"}
          disabled={answering}
          onClick={() => onAnswer(choice.id)}
        >
          {choice.name}
        </Button>
      ))}
      {kept.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={answering}
            render={
              <Button size="sm" variant="outline">
                More
                <ChevronDownIcon data-icon="inline-end" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {kept.map((choice) => (
              <DropdownMenuItem
                key={choice.id}
                onClick={() => onAnswer(choice.id)}
              >
                {choice.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

/** What the Person answered, once they have, or that it is no longer
 * asked. */
function Answered({
  question: { choices, form, state, answer, values },
}: {
  question: QuestionBody
}) {
  const filledIn =
    state === "answered" && form && values ? summary(form, values) : []
  if (filledIn.length > 0)
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {filledIn.map(({ id, title, value }) => (
          <Fragment key={id}>
            <dt className="text-muted-foreground">{title}</dt>
            <dd className="min-w-0 wrap-break-word">{value}</dd>
          </Fragment>
        ))}
      </dl>
    )
  const said =
    state !== "answered"
      ? "No longer asked."
      : !form
        ? `You chose: ${choices.find((c) => c.id === answer)?.name ?? answer}`
        : values
          ? "You sent it without filling anything in."
          : "You skipped it."
  return <p className="text-xs text-muted-foreground">{said}</p>
}

/**
 * The Question with a form that waits for the Person, on top of the
 * composer as T3 Code shows it: one field at a time, keys 1–9 pick a
 * field's choice. It folds to one line and opens again.
 */
export function QuestionDrawer({
  item,
  answering,
  onAnswer,
}: {
  item: Asked
  answering: boolean
  onAnswer: Answer
}) {
  const { title, choices, form } = item.body
  const [folded, setFolded] = useState(false)
  return (
    <Card
      icon={<ShieldQuestionIcon />}
      title={title}
      className="shadow-sm"
      action={
        <Button
          size="icon-xs"
          variant="ghost"
          aria-expanded={!folded}
          aria-label={folded ? "Show the question" : "Fold the question"}
          onClick={() => setFolded(!folded)}
        >
          {folded ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </Button>
      }
    >
      {!folded && form && (
        <QuestionForm
          // A new Question starts its form afresh.
          key={item.id}
          form={form}
          choices={choices}
          answering={answering}
          onAnswer={onAnswer}
        />
      )}
    </Card>
  )
}
