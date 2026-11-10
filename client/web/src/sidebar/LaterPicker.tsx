/**
 * The Later's picker (ADR 0074, decision 5): one wherever a Later
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
import { clock, Store, useRun, useStore } from "@banda/core/react"
import { left } from "@banda/ui/lib/words"
import type { Args } from "@banda/ui/module"
import type { Listed } from "@banda/ui/pane"
import { asleep, mayPutOff } from "@banda/ui/status"
import { AlarmClockIcon, ArrowRightIcon, LoaderIcon } from "lucide-react"
import { type ReactNode, useId, useMemo, useState } from "react"
import { useLookSidebar } from "../look"
import { itemActionOf } from "./items"
import { presets, whenOf } from "./later-time"

/** A Thread whose Later is being picked, and what the picker stands by. */
export type LaterTarget = {
  project: ProjectId
  listed: Listed
  anchor?: Element
}

/** The Thread the picker is open for; none while it is closed. */
const picking = new Store<LaterTarget | undefined>(undefined)
const now = (target: LaterTarget | undefined) => target

/** Opens the picker for a Thread, by its row where `anchor` is given;
 * none closes it. */
export function pickLater(target: LaterTarget | undefined): void {
  picking.set(target)
}

/** What is picked: a time for the Thread to come back at, when its turn
 * is done, or to wake it now. */
type Picked = number | "done" | "wake"

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

/** The picker, open for the Thread `pickLater` asked for: what is picked
 * runs its App's Later, or its wake, by the Window's `run`. */
export function LaterPicker() {
  const run = useRun()
  const target = useStore(picking, now)
  const onClose = () => pickLater(undefined)
  // Its App's, by what each does: the picker names none of its actions.
  const onLater = (
    { project, listed }: LaterTarget,
    until: number | "done"
  ) => {
    const action = itemActionOf(listed, "later")
    const when: Args = until === "done" ? { done: true } : { until }
    if (action) run(action.id, { project, item: listed.id, ...when })
  }
  const onWake = ({ project, listed }: LaterTarget) => {
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
            onPick={(picked) => {
              if (picked === "wake") onWake(target)
              else onLater(target, picked)
              onClose()
            }}
          />
        </PopoverContent>
      )}
    </Popover>
  )
}

/** The picker's lines, for one Thread. What is picked goes back by one
 * prop, not by a Later's and a wake's: the sidebar list takes no Thread's
 * verb as a prop (ADR 0087, B4e). */
function Picking({
  listed,
  onPick,
}: {
  listed: Listed
  onPick: (picked: Picked) => void
}) {
  const id = useId()
  const [now] = useState(Date.now)
  const [text, setText] = useState("")
  const [at, setAt] = useState(0)
  // The presets `sidebar.toml` names (ADR 0074, decision 9).
  const words = useLookSidebar().later.presets
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
      pick: () => onPick(typed),
    })
  if (asleep(listed, now))
    choices.push({
      label: "Wake now",
      note: "",
      icon: <AlarmClockIcon />,
      pick: () => onPick("wake"),
    })
  for (const preset of listedPresets)
    choices.push({
      label: preset.label,
      note: clock(preset.at, now),
      pick: () => onPick(preset.at),
    })
  if (works(listed.mark))
    choices.push({
      label: "When it's done",
      note: "the turn ends",
      icon: <LoaderIcon />,
      pick: () => onPick("done"),
    })
  const picked = Math.min(at, choices.length - 1)
  const title = (
    <div className="truncate px-1.5 pt-0.5 pb-1.5 text-xs text-muted-foreground">
      Later · <span className="text-foreground/80">{listed.title}</span>
    </div>
  )
  if (!mayPutOff(listed))
    return (
      <>
        {title}
        <p className="px-1.5 pb-1 text-sm text-muted-foreground">
          <span className="font-medium text-attention">It asks you.</span>{" "}
          Answer it first: a Thread that calls you can’t be put off.
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
