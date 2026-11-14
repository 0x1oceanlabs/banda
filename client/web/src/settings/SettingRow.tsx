/**
 * The one row (ADR 0016, decision 4): any key of any file, drawn from its
 * schema; what it is now and where that comes from beside it (decision 6);
 * and a ↶ for a key the Person's file sets. A change applies at once:
 * `banda settings set` writes it, and the look brings it back; a key of
 * another machine's, its engine (ADR 0106, step 5b).
 */
import type { JsonValue } from "@banda/contract"
import type { Problem } from "@banda/contract/look"
import { type Row, type Setting, tomlOf } from "@banda/contract/settings"
import { Button } from "@banda/ui/components/button"
import { Input } from "@banda/ui/components/input"
import { Choice, Many, RowFrame } from "@banda/ui/components/setting-row"
import { Switch } from "@banda/ui/components/switch"
import { useWrite } from "@banda/ui/hooks/use-write"
import { cn } from "@banda/ui/lib/utils"
import type { CustomRow, SettingsWriter } from "@banda/ui/settings"
import { FileCogIcon } from "lucide-react"
import { onThisDevice } from "./machine-settings"
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
  const { refused, write, forget } = useWrite({ against: setting?.value })
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
        <Custom
          row={row}
          setting={setting}
          set={set}
          control={control}
          refused={refused}
          forget={forget}
        />
      ) : (
        control
      )}
    </RowFrame>
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
