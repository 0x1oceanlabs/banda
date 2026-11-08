/**
 * The snooze's picker (ADR 0074, decision 5): one wherever a snooze
 * starts, by the row's clock, from a menu or with Alt+Z. A time typed in
 * its field, a preset, "When it's done" for a Thread at work, or Wake now
 * for one that sleeps; ↑ ↓ and Enter pick. It is the sidebar list's, and
 * what is picked, the Thread's App does, by its item actions (ADR 0087,
 * decision 12).
 */
import type { ProjectId } from "@banda/contract"
import { works } from "@banda/ui/components/banda-mark"
import { Input } from "@banda/ui/components/input"
import { Popover, PopoverContent } from "@banda/ui/components/popover"
import {
  Suggestion,
  SuggestionDescription,
  SuggestionList,
} from "@banda/ui/components/suggestions"
import { Store, useStore } from "@banda/ui/lib/store"
import { clock, left } from "@banda/ui/lib/words"
import type { Args } from "@banda/ui/module"
import { asleep, type Listed, snoozable } from "@banda/ui/pane"
import { AlarmClockIcon, ArrowRightIcon, LoaderIcon } from "lucide-react"
import { type ReactNode, useId, useMemo, useState } from "react"
import { useLookSidebar } from "../look"
import { itemActionOf } from "./items"
import { presets, whenOf } from "./snooze-time"

/** A Thread whose snooze is being picked, and what the picker stands by. */
export type Snoozing = { project: ProjectId; listed: Listed; anchor?: Element }

/** The Thread the picker is open for; none while it is closed. */
const picking = new Store<Snoozing | undefined>(undefined)
const now = (target: Snoozing | undefined) => target

/** Opens the picker for a Thread, by its row where `anchor` is given;
 * none closes it. */
export function pickSnooze(target: Snoozing | undefined): void {
  picking.set(target)
}

/** One line of the picker, and what picking it does. */
type Choice = {
  label: string
  note: string
  icon?: ReactNode
  pick: () => void
}

/** Where the picker stands with no row: where the Banda menu opens, at
 * the window's middle. */
const TOP = {
  getBoundingClientRect: () =>
    DOMRect.fromRect({
      x: window.innerWidth / 2,
      y: window.innerHeight * 0.12,
      width: 0,
      height: 0,
    }),
}

/** The picker, open for the Thread `pickSnooze` asked for: what is picked
 * runs its App's snooze, or its wake, by `run`. */
export function SnoozePicker({
  run,
}: {
  run: (action: string, args?: Args) => void
}) {
  const target = useStore(picking, now)
  const onClose = () => pickSnooze(undefined)
  // Its App's, by what each does: the picker names none of its actions.
  const onSnooze = ({ project, listed }: Snoozing, until?: number) => {
    const action = itemActionOf(listed, "snooze")
    const when: Args = until === undefined ? { done: true } : { until }
    if (action) run(action.id, { project, item: listed.id, ...when })
  }
  const onWake = ({ project, listed }: Snoozing) => {
    const action = itemActionOf(listed, "wake")
    if (action) run(action.id, { project, item: listed.id })
  }
  return (
    <Popover
      open={target !== undefined}
      onOpenChange={(open) => !open && onClose()}
    >
      {target && (
        <PopoverContent
          anchor={target.anchor ?? TOP}
          side={target.anchor ? "right" : "bottom"}
          align="start"
          sideOffset={6}
          className="w-72 gap-0 p-1.5"
        >
          <Picking
            key={`${target.project}:${target.listed.id}`}
            listed={target.listed}
            onSnooze={(until) => {
              onSnooze(target, until)
              onClose()
            }}
            onWake={() => {
              onWake(target)
              onClose()
            }}
          />
        </PopoverContent>
      )}
    </Popover>
  )
}

function Picking({
  listed,
  onSnooze,
  onWake,
}: {
  listed: Listed
  onSnooze: (until?: number) => void
  onWake: () => void
}) {
  const id = useId()
  const [now] = useState(Date.now)
  const [text, setText] = useState("")
  const [at, setAt] = useState(0)
  // The presets `sidebar.toml` names (ADR 0074, decision 9).
  const words = useLookSidebar().snooze.presets
  const listedPresets = useMemo(() => presets(words, now), [words, now])
  const typed = text.trim() ? whenOf(text, now) : undefined
  // What was typed comes first once it reads as a time, then Wake now
  // for a Thread that sleeps, then the presets.
  const choices: Choice[] = []
  if (typed !== undefined)
    choices.push({
      label: clock(typed, now),
      note: `in ${left(typed, now)}`,
      icon: <ArrowRightIcon />,
      pick: () => onSnooze(typed),
    })
  if (asleep(listed, now))
    choices.push({
      label: "Wake now",
      note: "",
      icon: <AlarmClockIcon />,
      pick: onWake,
    })
  for (const preset of listedPresets)
    choices.push({
      label: preset.label,
      note: clock(preset.at, now),
      pick: () => onSnooze(preset.at),
    })
  if (works(listed.mark))
    choices.push({
      label: "When it's done",
      note: "the turn ends",
      icon: <LoaderIcon />,
      pick: () => onSnooze(),
    })
  const picked = Math.min(at, choices.length - 1)
  const title = (
    <div className="truncate px-1.5 pt-0.5 pb-1.5 text-xs text-muted-foreground">
      Snooze · <span className="text-foreground/80">{listed.title}</span>
    </div>
  )
  if (!snoozable(listed))
    return (
      <>
        {title}
        <p className="px-1.5 pb-1 text-sm text-muted-foreground">
          <span className="font-medium text-attention">It asks you.</span>{" "}
          Answer it first: a Thread that calls you can’t be snoozed.
        </p>
      </>
    )
  return (
    <>
      {title}
      <Input
        autoFocus
        aria-label="When it comes back"
        aria-activedescendant={`${id}-${picked}`}
        placeholder="2h · 18:30 · tomorrow 10 · fri"
        spellCheck={false}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setAt(0)
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            const by = event.key === "ArrowDown" ? 1 : -1
            setAt((picked + by + choices.length) % choices.length)
          } else if (event.key === "Enter") {
            event.preventDefault()
            choices[picked]?.pick()
          }
        }}
      />
      {text.trim() && typed === undefined && (
        <p className="px-1.5 pt-1.5 text-xs text-muted-foreground">
          Not a time yet: try 45m, 3h, 18, tomorrow 10, fri.
        </p>
      )}
      <SuggestionList aria-label="When" className="mt-1">
        {choices.map((choice, index) => (
          <Suggestion
            key={`${choice.label}${choice.note}`}
            id={`${id}-${index}`}
            selected={index === picked}
            className="px-1.5"
            onPointerMove={() => setAt(index)}
            onClick={choice.pick}
          >
            <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5">
              {choice.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{choice.label}</span>
            <SuggestionDescription className="flex-none text-xs tabular-nums">
              {choice.note}
            </SuggestionDescription>
          </Suggestion>
        ))}
      </SuggestionList>
      <div className="flex gap-2 px-1.5 pt-1.5 pb-0.5 text-[11px] text-muted-foreground">
        <span>↑↓ Enter</span>
        <span>Esc</span>
      </div>
    </>
  )
}
