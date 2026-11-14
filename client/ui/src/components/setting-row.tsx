/**
 * The parts every row of Settings is drawn with (ADR 0016, decision 4),
 * the Window's and an App's section's own alike: rows in a card under a
 * title, the frame of one row, and a choice among a few options.
 */
import type { JsonValue } from "@banda/contract"
import type { From, Option } from "@banda/contract/settings"
import type { ReactNode } from "react"
import { Undo2Icon } from "lucide-react"
import { cn } from "../lib/utils"
import { Button } from "./button"
import { Card } from "./card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select"

/** Rows in a card, a line between each. */
export function Rows({ children }: { children: ReactNode }) {
  return <Card className="gap-0 divide-y py-0">{children}</Card>
}

/** A group of rows under its title, if it has one, and beside it whose
 * copy the group is, where that is not as its file says under the rows. */
export function Group({
  title,
  whose,
  children,
}: {
  title?: string
  whose?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {title && (
        <h2 className="flex flex-wrap items-center gap-x-1.5 px-1 text-meta font-medium text-muted-foreground">
          {title}
          {whose && (
            <>
              <span aria-hidden>·</span>
              <span className="font-normal">{whose}</span>
            </>
          )}
        </h2>
      )}
      <Rows>{children}</Rows>
    </div>
  )
}

/** Whose copy a row is, beside its title, where Settings shows another
 * machine's: "on this Mac". */
export function Whose({ children }: { children: ReactNode }) {
  return (
    <span className="text-meta font-normal text-muted-foreground">
      {children}
    </span>
  )
}

/**
 * The frame of every row, the schema's or a section's own: what it is,
 * where its value comes from, a ↶ for the Person's line, its control, and
 * what is wrong.
 */
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
export function Many({
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
