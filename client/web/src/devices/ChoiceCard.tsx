import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@banda/ui/components/field"
import { RadioGroupItem } from "@banda/ui/components/radio-group"

/** One choice of a radio group, as a card: what it is, and what it
 * means. */
export function ChoiceCard({
  value,
  title,
  about,
}: {
  value: string
  title: string
  about: string
}) {
  return (
    <FieldLabel className="w-full">
      <Field orientation="horizontal">
        <RadioGroupItem value={value} />
        <FieldContent>
          <FieldTitle>{title}</FieldTitle>
          <FieldDescription>{about}</FieldDescription>
        </FieldContent>
      </Field>
    </FieldLabel>
  )
}
