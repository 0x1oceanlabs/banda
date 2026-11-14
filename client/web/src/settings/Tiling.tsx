/**
 * What the Tiling's section draws itself (ADR 0016, decision 4; ADR 0127,
 * decision 4), where `tiling.toml`'s schema alone draws less well: a
 * width as a menu of the Steps, a list of shares as chips, and the rules
 * by kind of Pane, each named as its kind names itself and written in the
 * file. What is no share the file's own check refuses, in its words,
 * under the row.
 */
import { type ReactNode, useEffect, useRef, useState } from "react"
import type { JsonValue } from "@banda/contract"
import { type Row, rowsOf, tomlOf } from "@banda/contract/settings"
import { type Rule, TILING_FILE } from "@banda/contract/workspaces"
import { Button } from "@banda/ui/components/button"
import { Input } from "@banda/ui/components/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@banda/ui/components/select"
import { Group, RowFrame } from "@banda/ui/components/setting-row"
import { useFile } from "@banda/ui/lib/look"
import { cn } from "@banda/ui/lib/utils"
import type { CustomRow, SectionProps } from "@banda/ui/settings"
import { ExternalLinkIcon, PlusIcon, XIcon } from "lucide-react"
import { kindOf } from "../registry"
import { share } from "../tiling/model"

function sharesOf(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

/** Whether two shares are one, as the engine's `steps()` tells them. */
const same = (a: number, b: number) => Math.abs(a - b) < 1e-9

/** A list of shares as the row writes it and the engine reads it
 * (`steps()`): narrowest first, each share once. What is no share goes
 * last, for the file's check to refuse. */
export function inOrder(list: readonly string[]): string[] {
  const sized = list
    .map((text) => ({ text, size: share(text) ?? Infinity }))
    .sort((a, b) => (a.size === b.size ? 0 : a.size - b.size))
  return sized
    .filter(
      ({ size }, i) =>
        i === 0 || size === Infinity || !same(size, sized[i - 1]!.size)
    )
    .map(({ text }) => text)
}

/** `list` with the share typed where its size puts it; none when the
 * list has that share already, or nothing was typed. */
export function withShare(
  list: readonly string[],
  typed: string
): string[] | undefined {
  const text = typed.trim()
  const size = share(text)
  const has =
    size !== undefined && list.some((had) => same(share(had) ?? Infinity, size))
  return text && !has ? inOrder([...list, text]) : undefined
}

/** `list` without `gone`; none when it is the last one, as the file
 * needs one share at least. */
export function withoutShare(
  list: readonly string[],
  gone: string
): string[] | undefined {
  return list.length > 1
    ? inOrder(list.filter((one) => one !== gone))
    : undefined
}

/**
 * Whether a control is a field for now. It is one until what it shows
 * changes, so a write that went through closes it and a refused one
 * leaves it; `leave` closes it too, and forgets what was refused. As it
 * closes, the focus goes back to `back`, where nothing else took it.
 */
function useTyping(shows: string, forget: () => void) {
  const [since, setSince] = useState<string>()
  // What it shows changed: a field no more, whatever it shows next.
  if (since !== undefined && since !== shows) setSince(undefined)
  const typing = since === shows
  const back = useRef<HTMLButtonElement>(null)
  const was = useRef(false)
  useEffect(() => {
    if (was.current && !typing && document.activeElement === document.body)
      back.current?.focus()
    was.current = typing
  }, [typing])
  return {
    typing,
    start: () => setSince(shows),
    leave: () => {
      forget()
      setSince(undefined)
    },
    back,
  }
}

/** A small field in a control's place: Enter gives what was typed; Esc,
 * and leaving it, leave things as they were. */
function ShareField({
  label,
  start,
  bad,
  className,
  onEnter,
  onLeave,
}: {
  label: string
  /** What it holds as it comes, picked whole. */
  start?: string
  /** What it gave was refused. */
  bad: boolean
  className: string
  onEnter: (typed: string) => void
  onLeave: () => void
}) {
  return (
    <Input
      autoFocus
      aria-label={label}
      aria-invalid={bad || undefined}
      defaultValue={start}
      className={cn("text-right font-mono text-meta", className)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={onLeave}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== "Escape") return
        // Its own: Esc is not the Sheet's, which the next one takes away,
        // and Enter does not press what the focus goes back to.
        event.preventDefault()
        event.stopPropagation()
        if (event.key === "Enter") onEnter(event.currentTarget.value)
        else onLeave()
      }}
    />
  )
}

/** A control, and under it what its keys do while it is a field. */
function Hinted({ hint, children }: { hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-end gap-1">
      {children}
      {hint && (
        <p className="text-meta whitespace-nowrap text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}

/** The menu's last row, which no share is called. */
const OTHER = "other"

/** A width, `columns.default`: a menu of the Steps as the file has them
 * now, and a last row that turns it into a field, for any other share.
 * A share that is no step is shown, first in the menu. */
export const Width: CustomRow = ({ row, setting, set, refused, forget }) => {
  const steps = useFile(TILING_FILE).columns.presets
  const now = String(setting?.value ?? "")
  const { typing, start, leave, back } = useTyping(now, forget)
  if (typing)
    return (
      <Hinted
        hint={
          refused.length === 0
            ? "Enter writes it. Esc leaves it as it was."
            : undefined
        }
      >
        <ShareField
          label={row.title}
          start={now}
          bad={refused.length > 0}
          className="w-36"
          onEnter={(typed) => {
            const text = typed.trim()
            if (!text || text === now) leave()
            else set(tomlOf(text))
          }}
          onLeave={leave}
        />
      </Hinted>
    )
  return (
    <Select
      value={now}
      onValueChange={(picked) => {
        if (picked === OTHER) start()
        else if (picked) set(tomlOf(picked))
      }}
    >
      <SelectTrigger
        ref={back}
        aria-label={row.title}
        className="min-w-20 font-mono text-meta"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false}>
        <SelectGroup>
          {(steps.includes(now) ? steps : [now, ...steps]).map((step) => (
            <SelectItem key={step} value={step} className="font-mono text-meta">
              {step}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={OTHER}>Other…</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

const CHIP =
  "inline-flex h-6 items-center gap-1 rounded-control border px-2 font-mono text-meta whitespace-nowrap"

/** A list of shares, `columns.presets`, as chips: a × on the chip under
 * the pointer or with the focus takes it out, and a + at the end is a
 * small field that adds one. The row writes the list in its order
 * ({@link inOrder}), so there is nothing to drag. */
export const Shares: CustomRow = ({ row, setting, set, refused, forget }) => {
  const list = sharesOf(setting?.value)
  const { typing, start, leave, back } = useTyping(list.join(" "), forget)
  // The share added last, marked until the Person goes on.
  const [fresh, setFresh] = useState<string>()
  const remove = (gone: string) => {
    const next = withoutShare(list, gone)
    if (!next) return
    set(tomlOf(next))
    back.current?.focus()
  }
  return (
    <Hinted
      hint={
        typing && refused.length === 0
          ? "Enter adds it. Esc leaves the list as it was."
          : undefined
      }
    >
      <ul
        aria-label={row.title}
        className="flex max-w-72 flex-wrap justify-end gap-1"
      >
        {list.map((one) => (
          <li
            key={one}
            className={cn(
              CHIP,
              "group focus-within:border-ring focus-within:bg-accent hover:bg-accent",
              one === fresh && "border-ring"
            )}
          >
            {one}
            {list.length > 1 && (
              <button
                type="button"
                aria-label={`Remove ${one}`}
                title="Remove"
                className="sr-only -mr-1 text-muted-foreground outline-none group-focus-within:not-sr-only group-hover:not-sr-only hover:text-foreground"
                onClick={() => remove(one)}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" || event.key === "Delete")
                    remove(one)
                }}
              >
                <XIcon className="size-3" />
              </button>
            )}
          </li>
        ))}
        <li>
          {typing ? (
            <ShareField
              label={`Add to ${row.title}`}
              bad={refused.length > 0}
              className="h-6 w-14 px-2"
              onEnter={(typed) => {
                const next = withShare(list, typed)
                if (!next) return leave()
                setFresh(typed.trim())
                set(tomlOf(next))
              }}
              onLeave={leave}
            />
          ) : (
            <button
              ref={back}
              type="button"
              aria-label={`Add to ${row.title}`}
              title="Add a share"
              className={cn(
                CHIP,
                "px-1.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:border-ring"
              )}
              onClick={start}
              onBlur={() => setFresh(undefined)}
            >
              <PlusIcon className="size-3" />
            </button>
          )}
        </li>
      </ul>
    </Hinted>
  )
}

/** A width a rule says, in a Person's words; any other share, as written. */
const WIDE: { [width: string]: string } = {
  "1/3": "a third wide",
  "1/2": "half wide",
  "2/3": "two thirds wide",
  "1": "full width",
}

const OPENS: { [opens in NonNullable<Rule["opens"]>]: string } = {
  beside: "beside",
  below: "below",
  group: "in its Group",
  project: "on its Project's workspace",
}

/** What a rule says, in a Person's words: `a third wide, below`. */
export function ruleWords(rule: Rule): string {
  return [
    rule.width && (WIDE[rule.width] ?? `${rule.width} wide`),
    rule.opens && OPENS[rule.opens],
  ]
    .filter(Boolean)
    .join(", ")
}

/** The row of the rules, for a search to find and a link to name. */
export const RULES_ROW: Row = {
  ...rowsOf(TILING_FILE.name).find((row) => row.key === "rule")!,
  title: "Rules by kind of Pane",
  about:
    "How wide a new column for a kind of Pane opens, and where: written in tiling.toml.",
}

/** One rule: its kind's icon and name, as the kind says them, then what
 * the rule says. A kind this window does not have, as its App is off or
 * its name mistyped, keeps the file's name, in the file's letters. */
function RuleRow({ kind, rule }: { kind: string; rule: Rule }) {
  const known = kindOf(kind)
  return (
    <div
      data-key={`${RULES_ROW.key}.${kind}`}
      className="flex items-center gap-3 px-4 py-3 text-ui"
    >
      <span className="flex w-32 shrink-0 items-center gap-2 font-medium">
        {known ? (
          <>
            <known.icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{known.name}</span>
          </>
        ) : (
          <span
            title={kind}
            className="truncate font-mono text-meta font-normal text-muted-foreground"
          >
            {kind}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 text-muted-foreground">
        {ruleWords(rule)}
      </span>
    </div>
  )
}

/** The rules the file has now, a row each, and the file to write one
 * in: a rule is not changed here. */
export function TilingRules({ lit, reveal }: SectionProps) {
  const rules = Object.entries(useFile(TILING_FILE).rules)
  const none = rules.length === 0
  return (
    <Group title={RULES_ROW.title}>
      {rules.map(([kind, rule]) => (
        <RuleRow key={kind} kind={kind} rule={rule!} />
      ))}
      <RowFrame
        dataKey={RULES_ROW.key}
        lit={lit === RULES_ROW.key}
        title={none ? "No rules" : null}
        about={
          none
            ? "A kind of Pane opens as its App and the Flow say. A rule is written in the file."
            : "A rule is written in the file."
        }
      >
        {reveal && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => reveal(TILING_FILE.name)}
          >
            <ExternalLinkIcon />
            Open file
          </Button>
        )}
      </RowFrame>
    </Group>
  )
}
