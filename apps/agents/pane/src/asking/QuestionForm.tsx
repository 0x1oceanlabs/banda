import { useId, useImperativeHandle, useState } from "react"
import type {
  Choice,
  Field as FormField,
  Input as FieldInput,
} from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import { Checkbox } from "@banda/ui/components/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@banda/ui/components/field"
import { Input } from "@banda/ui/components/input"
import { Kbd } from "@banda/ui/components/kbd"
import { RadioGroup, RadioGroupItem } from "@banda/ui/components/radio-group"
import {
  type Draft,
  draftOf,
  filled,
  problem,
  ready,
  type Values,
} from "./form"
import { answersOf } from "./asking"

/** A Question that asks for a form, one field at a time as T3 Code asks
 * (ADR 0010, decision 5): Previous, and Next or Submit, which Enter
 * presses; keys 1–9 pick a choice of the field shown. The answer that
 * says no, with Esc, skips the form; the main one submits what was filled
 * in, and any other skips it. */
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
  const set = (id: string, value: Draft[string]) =>
    setDraft((now) => ({ ...now, [id]: value }))
  const complete = ready(form, draft)
  const pages = form.length
  const last = page >= pages - 1
  const field = form[page]
  const { decline, main, others, kept } = answersOf(choices)
  // Next, or on the last field the main answer once the form can go.
  const onward = () => {
    if (answering) return true
    if (!last) setPage(page + 1)
    else if (main && complete) onAnswer(main.id, filled(form, draft))
    else return false
    return true
  }
  useImperativeHandle(enter, () => onward)
  const keys = (event: React.KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target
    const typing = target instanceof HTMLInputElement && target.type !== "radio"
    if (event.key === "Enter" && !event.shiftKey) {
      // Enter in a field or on a choice moves on, as in a form.
      const onField =
        (typing && target.type !== "checkbox") ||
        (target instanceof Element && target.closest("[role=radio]"))
      if (!onField || event.nativeEvent.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      onward()
      return
    }
    const choice =
      field?.input.kind === "choice" &&
      field.input.choices[Number(event.key) - 1]
    if (typing || !choice) return
    event.preventDefault()
    set(field.id, choice.value)
    if (!last) setPage(page + 1)
  }
  return (
    <div className="flex flex-col gap-3" onKeyDown={keys}>
      <FieldGroup className="gap-4">
        {field && (
          <FormInput
            key={field.id}
            field={field}
            value={draft[field.id]}
            disabled={answering}
            onChange={(value) => set(field.id, value)}
          />
        )}
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-2">
        {decline && (
          <Button
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
        {pages > 1 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {page + 1} of {pages}
          </span>
        )}
        {page > 0 && (
          <Button
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
              size="sm"
              variant="outline"
              disabled={answering}
              onClick={() =>
                choice.allows
                  ? onAnswer(choice.id, filled(form, draft))
                  : onAnswer(choice.id)
              }
            >
              {choice.name}
            </Button>
          ))}
        {(!last || main) && (
          <Button
            size="sm"
            className="pr-1.5"
            aria-keyshortcuts="Enter"
            disabled={answering || (last && !complete)}
            onClick={onward}
          >
            {last ? main?.name : "Next"}
            <KeyHint>⏎</KeyHint>
          </Button>
        )}
      </div>
    </div>
  )
}

/** The key that gives an answer, on its button, as a quiet cap in the
 * button's own colour. Its button says it in `aria-keyshortcuts`. */
export function KeyHint({ children }: { children: React.ReactNode }) {
  return (
    <Kbd
      aria-hidden
      className="h-4 min-w-4 border-current/30 bg-transparent px-1 font-mono text-small font-normal text-current opacity-70"
    >
      {children}
    </Kbd>
  )
}

function FormInput({
  field,
  value,
  disabled,
  onChange,
}: {
  field: FormField
  value: Draft[string]
  disabled: boolean
  onChange: (value: Draft[string]) => void
}) {
  const { title, description, required, secret, input } = field
  const id = useId()
  const wrong = problem(field, value)
  // The input points at what tells about it: its description, its problem.
  const describedBy =
    [description && `${id}-about`, wrong && `${id}-wrong`]
      .filter(Boolean)
      .join(" ") || undefined
  const about = description && (
    <FieldDescription id={`${id}-about`}>{description}</FieldDescription>
  )
  const error = wrong && <FieldError id={`${id}-wrong`}>{wrong}</FieldError>
  switch (input.kind) {
    case "text":
    case "number":
      return (
        <Field data-invalid={wrong !== undefined}>
          <FieldLabel htmlFor={id}>{title}</FieldLabel>
          <Input
            id={id}
            type={secret ? "password" : typed(input)}
            value={String(value)}
            disabled={disabled}
            required={required}
            aria-invalid={wrong !== undefined}
            aria-describedby={describedBy}
            onChange={(event) => onChange(event.target.value)}
            {...(input.kind === "number" && {
              min: input.minimum,
              max: input.maximum,
              step: input.integer ? 1 : "any",
            })}
          />
          {about}
          {error}
        </Field>
      )
    case "choice":
      return (
        <FieldSet>
          <div className="flex items-center justify-between gap-2">
            <FieldLegend id={`${id}-title`} variant="label">
              {title}
            </FieldLegend>
            {!required && value !== "" && (
              <Button
                size="xs"
                variant="ghost"
                disabled={disabled}
                onClick={() => onChange("")}
              >
                Clear
              </Button>
            )}
          </div>
          {about}
          <RadioGroup
            value={value}
            disabled={disabled}
            aria-labelledby={`${id}-title`}
            aria-describedby={describedBy}
            onValueChange={(next) => onChange(String(next))}
          >
            {input.choices.map((choice, at) => (
              <Field key={choice.value} orientation="horizontal">
                <RadioGroupItem
                  value={choice.value}
                  id={`${id}-${at}`}
                  aria-keyshortcuts={at < 9 ? String(at + 1) : undefined}
                />
                <Chosen id={`${id}-${at}`} {...choice} />
                {at < 9 && (
                  <span className="ml-auto flex text-muted-foreground">
                    <KeyHint>{at + 1}</KeyHint>
                  </span>
                )}
              </Field>
            ))}
          </RadioGroup>
        </FieldSet>
      )
    case "choices": {
      const picked = Array.isArray(value) ? value : []
      return (
        <FieldSet data-invalid={wrong !== undefined}>
          <FieldLegend variant="label">{title}</FieldLegend>
          {about}
          <FieldGroup data-slot="checkbox-group" className="gap-3">
            {input.choices.map((choice, at) => (
              <Field key={choice.value} orientation="horizontal">
                <Checkbox
                  id={`${id}-${at}`}
                  checked={picked.includes(choice.value)}
                  disabled={disabled}
                  aria-describedby={describedBy}
                  onCheckedChange={(on) =>
                    onChange(
                      on
                        ? [...picked, choice.value]
                        : picked.filter((v) => v !== choice.value)
                    )
                  }
                />
                <Chosen id={`${id}-${at}`} {...choice} />
              </Field>
            ))}
          </FieldGroup>
          {error}
        </FieldSet>
      )
    }
    case "toggle":
      return (
        <Field orientation="horizontal">
          <Checkbox
            id={id}
            checked={value === true}
            disabled={disabled}
            aria-describedby={describedBy}
            onCheckedChange={(on) => onChange(on)}
          />
          <Chosen id={id} name={title} description={description} />
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

/** A choice's name, and what it means when the Harness says. */
function Chosen({
  id,
  name,
  description,
}: {
  id: string
  name: string
  description?: string
}) {
  return (
    <FieldContent>
      <FieldLabel htmlFor={id} className="font-normal">
        {name}
      </FieldLabel>
      {description && (
        <FieldDescription id={`${id}-about`}>{description}</FieldDescription>
      )}
    </FieldContent>
  )
}
