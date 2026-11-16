/**
 * A Form of an App's screen: a field for each param of its command, and
 * what the Person typed held here, so nothing a later Tree says
 * overwrites a field.
 */
import type { TreeField, TreeForm } from "@banda/contract/apps"
import { Button } from "@banda/ui/components/button"
import { Checkbox } from "@banda/ui/components/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@banda/ui/components/field"
import { Input } from "@banda/ui/components/input"
import { RadioGroup, RadioGroupItem } from "@banda/ui/components/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@banda/ui/components/select"
import { Slider } from "@banda/ui/components/slider"
import { Spinner } from "@banda/ui/components/spinner"
import { Switch } from "@banda/ui/components/switch"
import { Textarea } from "@banda/ui/components/textarea"
import { useAct } from "@banda/ui/hooks/use-act"
import {
  createContext,
  type FormEvent,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import { type Filled, type Given, onOrOff, paramsOf, startOf } from "./form"

/**
 * Sends the App's command `command`, and comes back once it is done and
 * the screen shows it. It throws what went wrong.
 */
export type Send = (
  command: string,
  params: Record<string, unknown>
) => Promise<void>

/** What closes the dialog a Form is in, once its command went: none
 * for a Form on the screen itself. */
export const Closing = createContext<(() => void) | undefined>(undefined)

/** What a text field's kind is to the browser. */
const TYPES: Partial<Record<TreeField["kind"], string>> = {
  date: "date",
  time: "time",
  datetime: "datetime-local",
  email: "email",
  url: "url",
  password: "password",
}

/**
 * The form. `given` is what its fields start from, as a row's cells, and
 * `sent` the params that go with what it fills, as a row's id. Once the
 * command went, a form in a dialog closes it; one on the screen starts
 * again for the next one.
 */
export function FormNode({
  form,
  send,
  given,
  sent,
}: {
  form: TreeForm
  send: Send
  given?: Given
  sent?: Record<string, unknown>
}) {
  const id = useId()
  const close = useContext(Closing)
  const [filled, setFilled] = useState<Filled>(() =>
    startOf(form.fields, given)
  )
  /** What stops it from being sent, by field: said under the field. */
  const [amiss, setAmiss] = useState<Record<string, string>>({})
  const { busy, problem, act } = useAct()

  const set = (name: string, value: string | boolean) => {
    setFilled((filled) => ({ ...filled, [name]: value }))
    setAmiss((amiss) =>
      Object.fromEntries(
        Object.entries(amiss).filter(([field]) => field !== name)
      )
    )
  }

  const first = useRef<HTMLDivElement>(null)
  // The form as the Tree read last says it: once its command went and
  // the screen shows it, it starts again from what the App writes now.
  const latest = useRef(form)
  useEffect(() => {
    latest.current = form
  }, [form])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    // A form in a dialog is its own: the form around it is not sent.
    event.stopPropagation()
    if (busy) return
    const read = paramsOf(form.fields, filled, given)
    if ("amiss" in read) {
      setAmiss(read.amiss)
      return
    }
    void act(async () => {
      await send(form.command, { ...form.params, ...sent, ...read.params })
      if (close) return close()
      setFilled(startOf(latest.current.fields, given))
      // Ready for the next one, from its first field.
      first.current?.querySelector<HTMLElement>("input, textarea")?.focus()
    }, form.submit)
  }

  return (
    <form
      data-slot="tree-form"
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-3"
    >
      {form.title && <h2 className="text-ui font-semibold">{form.title}</h2>}
      {/* A field keeps a width that reads, however wide its Pane is. */}
      <FieldGroup ref={first} className="max-w-md gap-3">
        {form.fields.map((field) => (
          <FieldView
            key={field.name}
            id={`${id}-${field.name}`}
            field={field}
            value={filled[field.name] ?? ""}
            amiss={amiss[field.name]}
            set={(value) => set(field.name, value)}
          />
        ))}
      </FieldGroup>
      {problem && <FieldError>{problem}</FieldError>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" aria-busy={busy}>
          {busy && <Spinner />}
          {form.submit}
        </Button>
      </div>
    </form>
  )
}

function FieldView({
  id,
  field,
  value,
  amiss,
  set,
}: {
  id: string
  field: TreeField
  value: string | boolean
  amiss: string | undefined
  set: (value: string | boolean) => void
}) {
  // A switch and a radio group say their own names: nothing of theirs
  // takes a label's click.
  const named = field.kind === "switch" || field.kind === "radio"
  const label = (
    <FieldLabel id={`${id}-label`} htmlFor={named ? undefined : id}>
      {field.label}
      {field.required && <span aria-hidden>*</span>}
    </FieldLabel>
  )
  const said = (
    <>
      {field.about && <FieldDescription>{field.about}</FieldDescription>}
      {amiss && <FieldError>{amiss}</FieldError>}
    </>
  )
  const invalid = amiss ? true : undefined
  const shared = {
    id,
    "aria-invalid": invalid,
    "aria-required": field.required || undefined,
  }
  if (onOrOff(field.kind))
    return (
      <Field data-invalid={invalid}>
        <div className="flex items-center gap-2">
          {field.kind === "switch" ? (
            <Switch label={field.label} on={value === true} onChange={set} />
          ) : (
            <Checkbox
              {...shared}
              checked={value === true}
              onCheckedChange={(on) => set(on === true)}
            />
          )}
          {label}
        </div>
        {said}
      </Field>
    )
  const text = typeof value === "string" ? value : ""
  const placeholder = field.placeholder ?? undefined
  const options = field.options ?? []
  return (
    <Field data-invalid={invalid}>
      {label}
      {field.kind === "select" ? (
        <Select
          value={text === "" ? null : text}
          onValueChange={(value) => set(typeof value === "string" ? value : "")}
        >
          <SelectTrigger {...shared}>
            <SelectValue placeholder={placeholder}>
              {(value: string | null) =>
                options.find((option) => option.value === value)?.label
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.kind === "radio" ? (
        <RadioGroup
          aria-labelledby={`${id}-label`}
          aria-invalid={invalid}
          aria-required={field.required || undefined}
          value={text}
          onValueChange={(value) => set(typeof value === "string" ? value : "")}
        >
          {options.map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-2 text-ui"
            >
              <RadioGroupItem value={option.value} />
              {option.label}
            </label>
          ))}
        </RadioGroup>
      ) : field.kind === "slider" ? (
        <div className="flex items-center gap-3">
          <Slider
            aria-label={field.label}
            // The engine gives a slider all three.
            min={field.min ?? 0}
            max={field.max ?? 100}
            step={field.step ?? 1}
            value={Number(text)}
            onChange={(value) => set(String(value))}
          />
          <span className="w-10 text-right text-meta text-muted-foreground tabular-nums">
            {text}
          </span>
        </div>
      ) : field.kind === "textarea" ? (
        <Textarea
          {...shared}
          value={text}
          placeholder={placeholder}
          onChange={(event) => set(event.target.value)}
        />
      ) : (
        <Input
          {...shared}
          type={TYPES[field.kind] ?? "text"}
          value={text}
          placeholder={placeholder}
          inputMode={field.kind === "number" ? "decimal" : undefined}
          autoComplete="off"
          onChange={(event) => set(event.target.value)}
        />
      )}
      {said}
    </Field>
  )
}
