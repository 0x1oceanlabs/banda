import { useId, useState } from "react"
import type { Choice, Field as FormField } from "@bandaso/contract/agents"
import { Button } from "@bandaso/ui/components/button"
import { Checkbox } from "@bandaso/ui/components/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@bandaso/ui/components/field"
import { Input } from "@bandaso/ui/components/input"
import { RadioGroup, RadioGroupItem } from "@bandaso/ui/components/radio-group"
import { type Draft, draftOf, filled, ready, type Values } from "./form"

/** A Question that asks for a form: its fields, then the Harness's answers.
 * The answer that allows submits what was filled in; the others skip it. */
export function QuestionForm({
  form,
  choices,
  answering,
  onAnswer,
}: {
  form: FormField[]
  choices: Choice[]
  answering: boolean
  onAnswer: (choice: string, values?: Values) => void
}) {
  const [draft, setDraft] = useState(() => draftOf(form))
  const set = (id: string, value: Draft[string]) =>
    setDraft((now) => ({ ...now, [id]: value }))
  const complete = ready(form, draft)
  return (
    <>
      <FieldGroup className="gap-4">
        {form.map((field) => (
          <FormInput
            key={field.id}
            field={field}
            value={draft[field.id]}
            disabled={answering}
            onChange={(value) => set(field.id, value)}
          />
        ))}
      </FieldGroup>
      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => (
          <Button
            key={choice.id}
            size="sm"
            variant={choice.allows ? "default" : "outline"}
            disabled={answering || (choice.allows && !complete)}
            onClick={() =>
              choice.allows
                ? onAnswer(choice.id, filled(form, draft))
                : onAnswer(choice.id)
            }
          >
            {choice.name}
          </Button>
        ))}
      </div>
    </>
  )
}

function FormInput({
  field: { title, description, input },
  value,
  disabled,
  onChange,
}: {
  field: FormField
  value: Draft[string]
  disabled: boolean
  onChange: (value: Draft[string]) => void
}) {
  const id = useId()
  const about = description && (
    <FieldDescription>{description}</FieldDescription>
  )
  switch (input.kind) {
    case "text":
    case "number":
      return (
        <Field>
          <FieldLabel htmlFor={id}>{title}</FieldLabel>
          <Input
            id={id}
            type={input.kind}
            value={String(value)}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            {...(input.kind === "number" && {
              min: input.minimum,
              max: input.maximum,
              step: input.integer ? 1 : "any",
            })}
          />
          {about}
        </Field>
      )
    case "choice":
      return (
        <FieldSet>
          <FieldLegend variant="label">{title}</FieldLegend>
          {about}
          <RadioGroup
            value={value}
            disabled={disabled}
            onValueChange={(next) => onChange(String(next))}
          >
            {input.choices.map((choice, at) => (
              <Field key={choice.value} orientation="horizontal">
                <RadioGroupItem value={choice.value} id={`${id}-${at}`} />
                <Chosen id={`${id}-${at}`} {...choice} />
              </Field>
            ))}
          </RadioGroup>
        </FieldSet>
      )
    case "choices": {
      const picked = Array.isArray(value) ? value : []
      return (
        <FieldSet>
          <FieldLegend variant="label">{title}</FieldLegend>
          {about}
          <FieldGroup data-slot="checkbox-group" className="gap-3">
            {input.choices.map((choice, at) => (
              <Field key={choice.value} orientation="horizontal">
                <Checkbox
                  id={`${id}-${at}`}
                  checked={picked.includes(choice.value)}
                  disabled={disabled}
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
            onCheckedChange={(on) => onChange(on)}
          />
          <Chosen id={id} name={title} description={description} />
        </Field>
      )
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
      {description && <FieldDescription>{description}</FieldDescription>}
    </FieldContent>
  )
}
