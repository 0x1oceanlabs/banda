import { useId, useImperativeHandle, useState } from "react"
import type {
  Choice,
  Field as FormField,
  Input as FieldInput,
  OptionChoice,
} from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import { Checkbox } from "@banda/ui/components/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@banda/ui/components/field"
import { Input } from "@banda/ui/components/input"
import { Kbd } from "@banda/ui/components/kbd"
import {
  Questionnaire,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireTitle,
} from "@banda/ui/components/questionnaire"
import { cn } from "@banda/ui/lib/utils"
import { CheckIcon } from "lucide-react"
import {
  answered,
  asked,
  type Draft,
  draftOf,
  filled,
  problem,
  ready,
  type Values,
} from "./form"
import { answersOf } from "./asking"

/** A Question that asks for a form, as shadcn's Questionnaire asks (ADR
 * 0010, decision 5; #1513): one question at a time, its choices as rows
 * that keys 1–9 pick, and the words that answer it in the Person's own as
 * the last row. A pick moves on to the next question. One question of one
 * choice is answered by its pick, with no Submit. Several have a step each,
 * named by the Harness's title, that goes back to it. The answer that says
 * no, with Esc, skips the form; the main one, with Enter, submits what was
 * filled in; any other skips it. */
export function QuestionForm({
  form,
  choices,
  answering,
  onAnswer,
  enter,
}: {
  form: FormField[]
  choices: Choice[]
  answering: boolean
  onAnswer: (choice: string, values?: Values) => void
  /** Gets what Enter does from outside the form: whether it did. */
  enter?: React.Ref<() => boolean>
}) {
  const [draft, setDraft] = useState(() => draftOf(form))
  const [page, setPage] = useState(0)
  const set = (changes: Draft) => setDraft((now) => ({ ...now, ...changes }))
  const shown = asked(form)
  const values = filled(form, draft)
  const complete = ready(form, draft)
  const pages = shown.length
  const last = page >= pages - 1
  const field = shown[page]
  const { decline, main, others, kept } = answersOf(choices)
  // One question of one choice: its pick is the answer.
  const picked =
    pages === 1 &&
    field?.input.kind === "choice" &&
    main !== undefined &&
    others.length === 0 &&
    kept.length === 0
  const own = field?.other !== undefined && values[field.other] !== undefined
  const submit = (draftNow: Draft) => {
    if (answering || !main || !ready(form, draftNow)) return false
    onAnswer(main.id, filled(form, draftNow))
    return true
  }
  // Next, or on the last question the main answer once the form can go.
  const onward = () => {
    if (answering) return true
    if (!last) setPage(page + 1)
    else if (!submit(draft)) return false
    return true
  }
  useImperativeHandle(enter, () => onward)
  // A pick of one choice moves on; of the only question, it answers.
  const pick = (at: FormField, value: string) => {
    const changes: Draft = { [at.id]: value }
    // One of one choice: the own words were another answer, and go.
    if (at.other !== undefined) changes[at.other] = ""
    const next = { ...draft, ...changes }
    setDraft(next)
    if (picked) submit(next)
    else if (!last) setPage(page + 1)
  }
  const write = (at: FormField, text: string) => {
    if (at.other === undefined) return
    const changes: Draft = { [at.other]: text }
    // Of one choice, the own words are the answer in place of a pick.
    if (at.input.kind === "choice" && text.trim() !== "") changes[at.id] = ""
    set(changes)
  }
  // The key after the choices goes to the own words, which the
  // Questionnaire gives no key; Enter in a field of text moves on, as in a
  // form, or in the own words sends them. Its choices take theirs.
  const keys = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.nativeEvent.isComposing) return
    const target = event.target
    const typing =
      target instanceof HTMLInputElement &&
      !["checkbox", "radio"].includes(target.type)
    const choices =
      field?.input.kind === "choice" || field?.input.kind === "choices"
        ? field.input.choices.length
        : 0
    if (
      !typing &&
      field?.other !== undefined &&
      choices < 9 &&
      event.key === String(choices + 1)
    ) {
      const words = event.currentTarget.querySelector<HTMLInputElement>(
        "fieldset[data-active] [data-slot=questionnaire-input]"
      )
      if (!words) return
      event.preventDefault()
      event.stopPropagation()
      words.focus()
      return
    }
    if (event.key !== "Enter" || !typing) return
    event.preventDefault()
    event.stopPropagation()
    onward()
  }
  return (
    <div onKeyDownCapture={keys}>
      <Questionnaire
        item={field?.id}
        onItemChange={(name) => {
          const at = shown.findIndex((f) => f.id === name)
          if (at >= 0) setPage(at)
        }}
        shortcuts="numbers"
        onSubmit={(event) => {
          event.preventDefault()
          if (!last) setPage(page + 1)
          else submit(draft)
        }}
      >
        {pages > 1 && (
          <Steps
            fields={shown}
            page={page}
            values={values}
            disabled={answering}
            onPage={setPage}
          />
        )}
        {shown.map((at) => (
          <QuestionnaireItem
            key={at.id}
            name={at.id}
            required={at.required}
            multiple={at.input.kind === "choices"}
            disabled={answering}
          >
            <Asks field={at} single={pages === 1} />
            <FormInput
              field={at}
              draft={draft}
              disabled={answering}
              onChange={(value) => set({ [at.id]: value })}
              onPick={(value) => pick(at, value)}
              onWrite={(text) => write(at, text)}
            />
          </QuestionnaireItem>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          {decline && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="pr-1.5"
              aria-keyshortcuts="Escape"
              disabled={answering}
              onClick={() => onAnswer(decline.id)}
            >
              {decline.name}
              <KeyHint>Esc</KeyHint>
            </Button>
          )}
          <span className="flex-1" />
          {page > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              disabled={answering}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
          )}
          {last &&
            [...others, ...kept].map((choice) => (
              <Button
                key={choice.id}
                type="button"
                size="sm"
                variant="outline"
                disabled={answering}
                onClick={() =>
                  choice.allows
                    ? onAnswer(choice.id, values)
                    : onAnswer(choice.id)
                }
              >
                {choice.name}
              </Button>
            ))}
          {(!last || (main && (!picked || own))) && (
            <Button
              type="button"
              size="sm"
              className="pr-1.5"
              aria-keyshortcuts="Enter"
              disabled={
                answering ||
                (last
                  ? !complete
                  : field !== undefined &&
                    field.required &&
                    !answered(field, values))
              }
              onClick={onward}
            >
              {last ? main?.name : "Next"}
              <KeyHint>⏎</KeyHint>
            </Button>
          )}
        </div>
      </Questionnaire>
    </div>
  )
}

/** The questions as steps, each named by the Harness's title, a tick on
 * those answered; a step goes back to its question. */
function Steps({
  fields,
  page,
  values,
  disabled,
  onPage,
}: {
  fields: FormField[]
  page: number
  values: Values
  disabled: boolean
  onPage: (page: number) => void
}) {
  return (
    <nav aria-label="Questions" className="-mb-1 -ml-2 flex flex-wrap gap-0.5">
      {fields.map((field, at) => {
        const done = answered(field, values)
        return (
          <button
            key={field.id}
            type="button"
            disabled={disabled}
            aria-current={at === page ? "step" : undefined}
            onClick={() => onPage(at)}
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-small px-2 text-meta whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
              done && "text-foreground",
              at === page && "bg-raised font-medium text-foreground"
            )}
          >
            {done ? (
              <CheckIcon aria-label="Answered" className="size-3 text-added" />
            ) : (
              <span className="tabular-nums opacity-70">{at + 1}</span>
            )}
            {field.title}
          </button>
        )
      })}
    </nav>
  )
}

/** What a question asks. Of several, the Harness's title names its step
 * and its description asks; of one, the title is a label above what the
 * Question already asks in its words. */
function Asks({ field, single }: { field: FormField; single: boolean }) {
  const { title, description } = field
  if (field.input.kind === "toggle") return null
  if (single || !description)
    return (
      <>
        <QuestionnaireTitle className="text-meta font-medium text-muted-foreground">
          {title}
        </QuestionnaireTitle>
        {description && (
          <QuestionnaireDescription className="mt-0 text-ui text-foreground">
            {description}
          </QuestionnaireDescription>
        )}
      </>
    )
  return <QuestionnaireTitle>{description}</QuestionnaireTitle>
}

/** The key that gives an answer, on its button, as a quiet cap in the
 * button's own colour. Its button says it in `aria-keyshortcuts`. */
export function KeyHint({ children }: { children: React.ReactNode }) {
  return (
    <Kbd
      aria-hidden
      className="h-4 min-w-4 border-current/30 bg-transparent px-1 font-mono text-[10.5px] font-normal text-current opacity-70"
    >
      {children}
    </Kbd>
  )
}

function FormInput({
  field,
  draft,
  disabled,
  onChange,
  onPick,
  onWrite,
}: {
  field: FormField
  draft: Draft
  disabled: boolean
  onChange: (value: Draft[string]) => void
  onPick: (value: string) => void
  onWrite: (text: string) => void
}) {
  const { title, description, required, secret, input, other } = field
  const value = draft[field.id]
  const id = useId()
  const wrong = problem(field, value)
  const error = wrong && <FieldError id={`${id}-wrong`}>{wrong}</FieldError>
  switch (input.kind) {
    case "text":
    case "number":
      return (
        <Field data-invalid={wrong !== undefined}>
          <Input
            id={id}
            aria-label={title}
            type={secret ? "password" : typed(input)}
            value={String(value)}
            disabled={disabled}
            required={required}
            aria-invalid={wrong !== undefined}
            aria-describedby={wrong ? `${id}-wrong` : undefined}
            onChange={(event) => onChange(event.target.value)}
            {...(input.kind === "number" && {
              min: input.minimum,
              max: input.maximum,
              step: input.integer ? 1 : "any",
            })}
          />
          {error}
        </Field>
      )
    case "choice":
    case "choices": {
      const many = input.kind === "choices"
      const picks = Array.isArray(value) ? value : []
      const words = other === undefined ? undefined : draft[other]
      const toggle = (choice: OptionChoice) =>
        onChange(
          picks.includes(choice.value)
            ? picks.filter((v) => v !== choice.value)
            : [...picks, choice.value]
        )
      return (
        <>
          <QuestionnaireChoices>
            {input.choices.map((choice) => (
              <QuestionnaireChoice
                key={choice.value}
                value={choice.value}
                checked={
                  many ? picks.includes(choice.value) : value === choice.value
                }
                disabled={disabled}
                onChange={() => (many ? toggle(choice) : onPick(choice.value))}
              >
                <span>{choice.name}</span>
                {choice.description && (
                  <QuestionnaireChoiceDescription>
                    {choice.description}
                  </QuestionnaireChoiceDescription>
                )}
              </QuestionnaireChoice>
            ))}
            {other !== undefined && (
              <QuestionnaireInput
                aria-label="In your own words"
                placeholder="Something else…"
                shortcut={
                  input.choices.length < 9
                    ? String(input.choices.length + 1)
                    : undefined
                }
                value={typeof words === "string" ? words : ""}
                disabled={disabled}
                onChange={(event) => onWrite(event.target.value)}
              />
            )}
          </QuestionnaireChoices>
          {error}
        </>
      )
    }
    case "toggle":
      return (
        <Field orientation="horizontal">
          <Checkbox
            id={id}
            checked={value === true}
            disabled={disabled}
            onCheckedChange={(on) => onChange(on)}
          />
          <FieldContent>
            <FieldLabel htmlFor={id} className="font-normal">
              {title}
            </FieldLabel>
            {description && <FieldDescription>{description}</FieldDescription>}
          </FieldContent>
        </Field>
      )
  }
}

/** The kind of box text goes in, from what the Harness says it takes. */
function typed(input: FieldInput): string {
  if (input.kind !== "text") return input.kind
  switch (input.format) {
    case "email":
      return "email"
    case "uri":
      return "url"
    case "date":
      return "date"
    case "date_time":
      return "datetime-local"
    default:
      return "text"
  }
}
