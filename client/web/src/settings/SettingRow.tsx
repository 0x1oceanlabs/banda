/**
 * The one row (ADR 0016, decision 4): any key of any file, drawn from its
 * schema; what it is now and where that comes from beside it (decision 6);
 * and a ↶ for a key the Person's file sets. A change applies at once:
 * `banda settings set` writes it, and the look brings it back; a key of
 * another machine's, its engine (ADR 0106, step 5b).
 */
import type { JsonValue } from "@banda/contract"
import type { Problem } from "@banda/contract/look"
import type { ReactNode } from "react"
import {
  type From,
  type Option,
  type Row,
  type Setting,
  tomlOf,
} from "@banda/contract/settings"
import { Button } from "@banda/ui/components/button"
import { Card } from "@banda/ui/components/card"
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
import { onThisDevice, type SettingsWriter } from "./machine-settings"
import type { CustomRow } from "./sections"
import { device } from "../boot"

export function SettingRow({
  row,
  setting,
  problems,
  lit,
  Custom,
  writer = onThisDevice,
  where,
}: {
  row: Row
  setting?: Setting
  /** Where it is written: this device's file, or a machine's engine. */
  writer?: SettingsWriter
  /** Whose copy it is, said beside it where Settings shows another
   * machine's: "on this Mac". */
  where?: string
  /** What is wrong in the file at this key. */
  problems: Problem[]
  /** A link named it: it shows lit. */
  lit?: boolean
  /** The section's own control, instead of the schema's. */
  Custom?: CustomRow
}) {
  // What was wrong when it was refused.
  const { refused, write } = useWrite({ against: setting?.value })
  const set = (value: string) => write(writer.set(row.file, row.key, value))
  const reset = () => write(writer.reset(row.file, row.key))
  const control = (
    <Control
      row={row}
      value={setting?.value}
      onSet={set}
      here={writer === onThisDevice}
    />
  )
  return (
    <RowFrame
      dataKey={row.key}
      lit={lit}
      title={row.title}
      about={row.about}
      file={row.file}
      where={where}
      from={setting?.from}
      onReset={reset}
      wrong={[...problems.map((p) => p.message), ...refused]}
    >
      {Custom ? (
        <Custom row={row} setting={setting} set={set} control={control} />
      ) : (
        control
      )}
    </RowFrame>
  )
}

/** Rows in a card, a line between each. */
export function Rows({ children }: { children: ReactNode }) {
  return <Card className="gap-0 divide-y py-0">{children}</Card>
}

/** A group of rows under its title, if it has one. */
export function Group({
  title,
  children,
}: {
  title?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {title && (
        <h2 className="px-1 text-meta font-medium text-muted-foreground">
          {title}
        </h2>
      )}
      <Rows>{children}</Rows>
    </div>
  )
}

/**
 * The frame of every row, the schema's or a section's own: what it is,
 * where its value comes from, a ↶ for the Person's line, its control, and
 * what is wrong.
 */
/** Whose copy a row is, beside its title, where Settings shows another
 * machine's: "on this Mac". */
export function Whose({ children }: { children: ReactNode }) {
  return (
    <span className="text-meta font-normal text-muted-foreground">
      {children}
    </span>
  )
}

export function RowFrame({
  dataKey,
  lit,
  title,
  about,
  file,
  from,
  where,
  onReset,
  wrong,
  children,
}: {
  /** What a link names it by. */
  dataKey: string
  /** A link named it: it shows lit. */
  lit?: boolean
  title: ReactNode
  about?: string
  /** Its file; none for a row of the engine's, as a Project's name. */
  file?: string
  from?: From
  /** Whose copy it is, where Settings shows another machine's. */
  where?: string
  /** Takes the Person's line out; shown when the value is theirs. */
  onReset?: () => void
  /** What was wrong, a message a line; each once. */
  wrong?: readonly string[]
  /** Its control. */
  children: ReactNode
}) {
  const mine = from?.layer === "file"
  return (
    <div
      data-key={dataKey}
      className={cn(
        "flex flex-col gap-1 px-4 py-3 transition-colors",
        lit && "bg-accent/60"
      )}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-40 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 text-ui font-medium">
            {mine && (
              <span
                aria-label="Set in your file"
                className="size-1.5 shrink-0 self-center rounded-full bg-primary"
              />
            )}
            {title}
            {file && <Origin from={from} file={file} />}
            {where && <Whose>{where}</Whose>}
          </div>
          {about && (
            <div className="text-meta text-muted-foreground">{about}</div>
          )}
        </div>
        {mine && onReset && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={`Reset ${dataKey}`}
            title="Reset: take your line out"
            onClick={onReset}
          >
            <Undo2Icon />
          </Button>
        )}
        <div className="flex shrink-0 items-center">{children}</div>
      </div>
      {[...new Set(wrong ?? [])].map((message) => (
        <p key={message} role="alert" className="text-meta text-destructive">
          {message}
        </p>
      ))}
    </div>
  )
}

/** Where the value comes from, when it is not Banda's own. */
function Origin({ from, file }: { from?: From; file: string }) {
  if (!from || from.layer === "defaults") return null
  // A key that moved is still the Person's line in the file it left,
  // while that one says it (ADR 0069 grace).
  const said = from.path?.split(/[\\/]/).pop() ?? file
  const words =
    from.layer === "file"
      ? `${said}${from.line ? `:${from.line}` : ""}`
      : from.layer === "hyprland"
        ? "from Hyprland"
        : `from the ${from.layer}`
  return (
    <span className="font-mono text-meta font-normal text-muted-foreground">
      {words}
    </span>
  )
}

function Control({
  row,
  value,
  onSet,
  here,
}: {
  row: Row
  value?: JsonValue
  onSet: (value: string) => void
  /** Its file is this computer's, to open here. */
  here: boolean
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
      // Another machine's file is edited there.
      if (!here)
        return (
          <span className="text-meta text-muted-foreground">
            In {row.file} there
          </span>
        )
      return (
        <Button
          variant="outline"
          size="sm"
          onClick={() => device.settings.reveal(row.file)}
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

/** An option of a choice, in words of its own instead of its value. */
export type Worded = Option & { words?: string }

function wordsOf(option: Worded): string {
  if (option.words !== undefined) return option.words
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
  options: Worded[]
  value?: JsonValue
  onPick: (value: JsonValue) => void
}) {
  if (options.length <= 4) {
    return (
      <div
        role="radiogroup"
        aria-label={label}
        className="flex rounded-control border p-0.5"
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
              "rounded-small px-2.5 py-0.5 text-meta text-muted-foreground",
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
              "rounded-control border px-2 py-0.5 text-meta text-muted-foreground",
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
export function Field({
  label,
  value,
  onCommit,
  className,
  ...input
}: {
  label: string
  value?: JsonValue
  onCommit: (text: string) => void
  /** Its width, where it holds more than a word: a list. */
  className?: string
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
        "h-8 text-right font-mono text-meta",
        input.type === "number" ? "w-24" : "w-36",
        className
      )}
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit(event.currentTarget.value)
      }}
      {...input}
    />
  )
}
