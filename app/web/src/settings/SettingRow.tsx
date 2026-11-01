/**
 * The one row (ADR 0016, decision 4): any key of any file, drawn from its
 * schema; what it is now and where that comes from beside it (decision 6);
 * and a ↶ for a key the Person's file sets. A change applies at once:
 * `banda settings set` writes it, and the look brings it back.
 */
import type { JsonValue } from "@banda/contract"
import type { Problem } from "@banda/contract/look"
import {
  type Option,
  type Row,
  type Setting,
  tomlOf,
} from "@banda/contract/settings"
import { Button } from "@banda/ui/components/button"
import { Input } from "@banda/ui/components/input"
import { Switch } from "@banda/ui/components/switch"
import { useWrite } from "@banda/ui/hooks/use-write"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@banda/ui/components/select"
import { cn } from "@banda/ui/lib/utils"
import { FileCogIcon, Undo2Icon } from "lucide-react"
import type { CustomRow } from "./sections"

export function SettingRow({
  row,
  setting,
  problems,
  lit,
  Custom,
}: {
  row: Row
  setting?: Setting
  /** What is wrong in the file at this key's line. */
  problems: Problem[]
  /** A link named it: it shows lit. */
  lit?: boolean
  /** The section's own control, instead of the schema's. */
  Custom?: CustomRow
}) {
  // Written through the desktop; what was wrong when it refused.
  const { refused, write } = useWrite()
  const settings = window.banda?.settings
  const set = (value: string) =>
    settings && write(settings.set(row.file, row.key, value))
  const reset = () => settings && write(settings.reset(row.file, row.key))
  const mine = setting?.from.layer === "file"
  const control = <Control row={row} value={setting?.value} onSet={set} />
  const wrong = [...problems.map((p) => p.message), ...refused]
  return (
    <div
      data-key={row.key}
      className={cn(
        "flex flex-col gap-1 px-4 py-3 transition-colors",
        lit && "bg-accent/60"
      )}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-40 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm font-medium">
            {mine && (
              <span
                aria-label="Set in your file"
                className="size-1.5 shrink-0 self-center rounded-full bg-primary"
              />
            )}
            {row.title}
            <Origin setting={setting} file={row.file} />
          </div>
          {row.about && (
            <div className="text-xs text-muted-foreground">{row.about}</div>
          )}
        </div>
        {mine && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={`Reset ${row.key}`}
            title="Reset: take your line out"
            onClick={reset}
          >
            <Undo2Icon />
          </Button>
        )}
        <div className="flex shrink-0 items-center">
          {Custom ? (
            <Custom row={row} setting={setting} set={set} control={control} />
          ) : (
            control
          )}
        </div>
      </div>
      {[...new Set(wrong)].map((message) => (
        <p key={message} role="alert" className="text-xs text-destructive">
          {message}
        </p>
      ))}
    </div>
  )
}

/** Where the value comes from, when it is not Banda's own. */
function Origin({ setting, file }: { setting?: Setting; file: string }) {
  const from = setting?.from
  if (!from || from.layer === "defaults") return null
  const words =
    from.layer === "file"
      ? `${file}${from.line ? `:${from.line}` : ""}`
      : from.layer === "hyprland"
        ? "from Hyprland"
        : `from the ${from.layer}`
  return (
    <span className="font-mono text-[11px] font-normal text-muted-foreground">
      {words}
    </span>
  )
}

function Control({
  row,
  value,
  onSet,
}: {
  row: Row
  value?: JsonValue
  onSet: (value: string) => void
}) {
  const control = row.control
  switch (control.kind) {
    case "switch":
      return (
        <Switch
          label={row.title}
          on={value === true}
          onChange={(on) => onSet(tomlOf(on))}
        />
      )
    case "choice":
      return (
        <Choice
          label={row.title}
          options={control.options}
          value={value}
          onPick={(picked) => onSet(tomlOf(picked))}
        />
      )
    case "many":
      return (
        <Many
          options={control.options}
          value={Array.isArray(value) ? value : []}
          onChange={(next) => onSet(tomlOf(next))}
        />
      )
    case "number":
      return (
        <Field
          label={row.title}
          type="number"
          value={value}
          min={control.min}
          max={control.max}
          step={control.integer ? 1 : "any"}
          onCommit={onSet}
        />
      )
    case "text":
    case "free":
      return (
        <Field
          label={row.title}
          value={value}
          // Words are a string; a value of more than one type, as typed.
          onCommit={(text) =>
            onSet(control.kind === "text" ? tomlOf(text) : text)
          }
        />
      )
    case "file":
      return (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void window.banda?.settings.reveal(row.file)}
        >
          <FileCogIcon />
          Edit in {row.file}
        </Button>
      )
  }
}

/** An option as a key and a value of a list: `true` and `"true"` apart. */
function keyOf(value: JsonValue | undefined): string {
  return JSON.stringify(value ?? null)
}

function wordsOf(option: Option): string {
  if (option.value === true) return "On"
  if (option.value === false) return "Off"
  return String(option.value)
}

/** A few options side by side; more in a list. */
export function Choice({
  label,
  options,
  value,
  onPick,
}: {
  label: string
  options: Option[]
  value?: JsonValue
  onPick: (value: JsonValue) => void
}) {
  if (options.length <= 4) {
    return (
      <div
        role="radiogroup"
        aria-label={label}
        className="flex rounded-md border p-0.5"
      >
        {options.map((option) => (
          <button
            key={keyOf(option.value)}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            title={option.about}
            onClick={() => onPick(option.value)}
            className={cn(
              "rounded px-2.5 py-0.5 text-xs text-muted-foreground",
              option.value === value && "bg-accent text-foreground"
            )}
          >
            {wordsOf(option)}
          </button>
        ))}
      </div>
    )
  }
  return (
    <Select
      value={keyOf(value)}
      onValueChange={(picked) => {
        const option = options.find((o) => keyOf(o.value) === picked)
        if (option) onPick(option.value)
      }}
    >
      <SelectTrigger aria-label={label} className="min-w-36">
        <SelectValue>
          {(picked: string) => {
            const option = options.find((o) => keyOf(o.value) === picked)
            return option ? wordsOf(option) : ""
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={keyOf(option.value)} value={keyOf(option.value)}>
            {wordsOf(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Some of the options, in the order they are picked. */
function Many({
  options,
  value,
  onChange,
}: {
  options: Option[]
  value: JsonValue[]
  onChange: (next: JsonValue[]) => void
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {options.map((option) => {
        const on = value.includes(option.value)
        return (
          <button
            key={keyOf(option.value)}
            type="button"
            aria-pressed={on}
            title={option.about}
            onClick={() =>
              onChange(
                on
                  ? value.filter((v) => v !== option.value)
                  : [...value, option.value]
              )
            }
            className={cn(
              "rounded-md border px-2 py-0.5 text-xs text-muted-foreground",
              on && "border-primary bg-accent text-foreground"
            )}
          >
            {wordsOf(option)}
          </button>
        )
      })}
    </div>
  )
}

/** A field that writes on Enter, or when it loses the focus. */
function Field({
  label,
  value,
  onCommit,
  ...input
}: {
  label: string
  value?: JsonValue
  onCommit: (text: string) => void
  type?: string
  min?: number
  max?: number
  step?: number | string
}) {
  const shown = value === undefined || value === null ? "" : String(value)
  const commit = (text: string) => {
    if (text !== shown && text !== "") onCommit(text)
  }
  return (
    <Input
      // A new value from the file starts the field afresh.
      key={shown}
      aria-label={label}
      defaultValue={shown}
      className={cn(
        "h-8 text-right font-mono text-xs",
        input.type === "number" ? "w-24" : "w-36"
      )}
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit(event.currentTarget.value)
      }}
      {...input}
    />
  )
}
