/**
 * A machine's updates in Settings → Machines (ADR 0119, decision 7): the
 * line the bar's widget shows for it, Update where one is ready, and
 * its machine.toml's `updates`: When idle, Ask or Off, written on that
 * machine through its engine. What it says is what its engine said on
 * `updates.state` (`bar/heard.tsx`).
 */
import { useState } from "react"
import type { Engine } from "@banda/contract"
import { tomlOf } from "@banda/contract/settings"
import type { TakeUpdates } from "@banda/contract/machines"
import { Button } from "@banda/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@banda/ui/components/select"
import { useNow } from "@banda/ui/hooks/use-now"
import { MINUTE } from "@banda/ui/lib/words"
import type { Named } from "@banda/contract/machines"
import { useHeard } from "../bar/update/heard"
import { rowOf, TAKES } from "../bar/update/machines"
import { useUpdateThere } from "../bar/update/Update"
import { RowFrame } from "./SettingRow"

/** The line of machine `host`'s updates, this machine's where none:
 * "dev.640 → dev.642. Updates by itself once 2 Agents finish." */
export function updatesLine(row: ReturnType<typeof rowOf>): string | undefined {
  const version = row.from && (row.to ? `${row.from} → ${row.to}` : row.from)
  const say =
    row.kind === "taking"
      ? row.size && `Updating, ${row.size}.`
      : (row.why ?? (row.status && `${row.status}.`))
  return [version, say].filter(Boolean).join(". ") || undefined
}

/** Machine `host`'s updates row, this machine's where none; `engine`
 * is its engine, and `live` whether the window reaches it. */
export function UpdatesRow({
  host,
  named,
  engine,
  live,
  lit,
}: {
  host?: string
  named: Named
  engine: Engine
  live: boolean
  lit?: boolean
}) {
  const heard = useHeard().get(host ?? "")
  const now = useNow(MINUTE)
  const machine = { host, ...named, away: !live, ...heard }
  const row = rowOf(machine, now)
  const takes = heard?.said?.takes
  const [problem, setProblem] = useState<string>()
  const restart = useUpdateThere(
    () => engine,
    (_machine, why) => setProblem(why)
  )
  const [busy, setBusy] = useState(false)
  const set = (value: TakeUpdates) => {
    setBusy(true)
    setProblem(undefined)
    engine
      .call("keys.settings_set", {
        file: "machine.toml",
        key: "updates",
        value: tomlOf(value),
      })
      .catch((error: Error) => setProblem(error.message))
      .finally(() => setBusy(false))
  }
  const line = updatesLine(row)
  return (
    <RowFrame
      dataKey={`${host ?? "this"}.updates`}
      lit={lit}
      title="Restart for updates"
      about={line}
      wrong={problem ? [problem] : undefined}
    >
      <span className="flex items-center gap-1.5">
        {row.act === "update" && live && (
          <Button size="sm" onClick={() => restart.ask(machine, row)}>
            Update
          </Button>
        )}
        <Select
          value={takes ?? null}
          disabled={!live || busy || takes === undefined}
          onValueChange={(value) => {
            if (value && value !== takes) set(value as TakeUpdates)
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label={`Restart for updates on ${named.name}`}
            className="min-w-28"
          >
            <SelectValue>
              {(value: TakeUpdates | null) => (value ? TAKES[value] : "…")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TAKES) as TakeUpdates[]).map((value) => (
              <SelectItem key={value} value={value}>
                {TAKES[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
      {restart.dialog}
    </RowFrame>
  )
}
