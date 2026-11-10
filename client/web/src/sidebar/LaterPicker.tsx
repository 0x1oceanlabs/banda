/**
 * The Later's picker (ADR 0074, decision 5): one wherever a Later
 * starts, by the row's clock, from a menu or with Alt+Z. A time typed in
 * its field, a preset, "When it's done" for a Thread at work, Wake now for
 * one that sleeps, or Someday, with no time (ADR 0098, decision 12); ↑ ↓
 * and Enter pick. Its first line follows where the Thread stands, so Z
 * then Enter does what is most likely. A Thread that asks may be put off
 * too: it waits with its question (decision 11). It is the sidebar
 * list's, and what is picked, the Thread's App does, by its item actions
 * (ADR 0087, decision 12).
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
import { useMinute } from "@banda/ui/hooks/use-now"
import { cn } from "@banda/ui/lib/utils"
import { left } from "@banda/ui/lib/words"
import type { Args } from "@banda/ui/module"
import type { Listed } from "@banda/ui/pane"
import { asleep } from "@banda/ui/status"
import {
  AlarmClockIcon,
  ArrowRightIcon,
  HourglassIcon,
  LoaderIcon,
} from "lucide-react"
import { type ReactNode, useId, useMemo, useState } from "react"
import { useLookSidebar } from "../look"
import { itemActionOf } from "./items"
import { type Preset, presets, whenOf } from "./later-time"

/** A Thread whose Later is being picked, what the picker stands by, and
 * what is told as something is picked: the sidebar's card it was opened
 * at hears that its Person put it off (ADR 0098, decision 6). */
export type LaterTarget = {
  project: ProjectId
  listed: Listed
  anchor?: Element
  onPicked?: () => void
}

/** The Thread the picker is open for; none while it is closed. */
const picking = new Store<LaterTarget | undefined>(undefined)
const now = (target: LaterTarget | undefined) => target
const anchorOf = (target: LaterTarget | undefined) => target?.anchor

/** What the picker stands by while it is open: the list holds still while
 * that is one of its cards. */
export function useLaterAnchor(): Element | undefined {
  return useStore(picking, anchorOf)
}

/** Opens the picker for a Thread, by its row where `anchor` is given;
 * none closes it. */
export function pickLater(target: LaterTarget | undefined): void {
  picking.set(target)
}

/** What is picked: a time for the Thread to come back at, its failed
 * turn going again then when it is a usage limit's reset (ADR 0074,
 * decision 8); when its turn is done; Someday; or to wake it now. */
type Picked = { until: number; resume?: true } | "done" | "someday" | "wake"

/** One line of the picker: its words, what it picks, its icon, and
 * whether a gap sets it apart from the lines above. */
export type Choice = {
  label: string
  note: string
  picks: Picked
  icon?: "typed" | "wake" | "done" | "limit"
  apart?: true
}

/** Each icon a line may have. */
const ICONS: Readonly<Record<NonNullable<Choice["icon"]>, ReactNode>> = {
  typed: <ArrowRightIcon />,
  wake: <AlarmClockIcon />,
  done: <LoaderIcon />,
  limit: <HourglassIcon />,
}

/** What the picker reads a Thread's lines from. */
type Reading = {
  listed: Listed
  now: number
  /** What the field reads as a time; none while it reads none. */
  typed?: number
  presets: readonly Preset[]
  /** When its usage limit resets, so its failed turn may go again then.
   * None until the list says it (`limitUntil`, ADR 0099, decision 11). */
  resets?: number
}

/**
 * The picker's lines for `listed` at `now`, in order: what was typed;
 * then what its state makes likeliest, so Enter alone picks it: Wake now
 * for one that sleeps, the limit's reset for one held by it, the end of
 * its turn for one at work; then the presets; and last, set apart,
 * Someday. What it already sleeps until is not offered again.
 */
export function choicesOf(reading: Reading): Choice[] {
  const { listed, now, typed, resets } = reading
  const sleeping = asleep(listed, now)
  // What it sleeps until now, if it has no time: not offered again.
  const already = !sleeping
    ? undefined
    : listed.later?.someday
      ? "someday"
      : listed.later?.until === undefined
        ? "done"
        : undefined
  const choices: Choice[] = []
  if (typed !== undefined)
    choices.push({
      label: clock(typed, now),
      note: `in ${left(typed, now)}`,
      picks: { until: typed },
      icon: "typed",
    })
  if (sleeping)
    choices.push({ label: "Wake now", note: "", picks: "wake", icon: "wake" })
  if (resets !== undefined && resets > now)
    choices.push({
      label: "When the limit resets",
      note: clock(resets, now),
      picks: { until: resets, resume: true },
      icon: "limit",
    })
  if (works(listed.mark) && already !== "done")
    choices.push({
      label: "When it's done",
      note: "the turn ends",
      picks: "done",
      icon: "done",
    })
  for (const preset of reading.presets)
    choices.push({
      label: preset.label,
      note: clock(preset.at, now),
      picks: { until: preset.at },
    })
  if (already !== "someday")
    choices.push({
      label: "Someday",
      note: "no time",
      picks: "someday",
      apart: true,
    })
  return choices
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
    picked: Exclude<Picked, "wake">
  ) => {
    const action = itemActionOf(listed, "later")
    const when: Args =
      picked === "done"
        ? { done: true }
        : picked === "someday"
          ? { someday: true }
          : { until: picked.until, ...(picked.resume ? { resume: true } : {}) }
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
              target.onPicked?.()
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

/** The time `choice` picks, when it has passed by `now`: the engine would
 * refuse it, so the picker says so in its place. None for a time to come,
 * or for a line that picks none. */
export function passedAt({ picks }: Choice, now: number): number | undefined {
  return typeof picks === "object" && picks.until <= now
    ? picks.until
    : undefined
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
  // The presets are worked out again as each minute begins, so none stays
  // past its time while the picker is open.
  const now = useMinute()
  const [text, setText] = useState("")
  const [at, setAt] = useState(0)
  // A time picked as it passed, which the engine would refuse: said here.
  const [passed, setPassed] = useState<number>()
  // The presets `sidebar.toml` names (ADR 0074, decision 9).
  const words = useLookSidebar().later.presets
  const listedPresets = useMemo(() => presets(words, now), [words, now])
  const typed = text.trim() ? whenOf(text, now) : undefined
  // A Thread its usage limit holds will offer the reset first once the
  // list says when (`limitUntil`, E1b): `resets` is left out till then.
  const choices = choicesOf({ listed, now, typed, presets: listedPresets })
  // The icons' column, only where the list's own lines have one, so the
  // words start at the field's edge else; a time being typed moves none.
  const iconed = choices.some((one) => one.icon && one.icon !== "typed")
  const picked = Math.min(at, choices.length - 1)
  const pick = (choice: Choice) => {
    const moment = Date.now()
    // A typed time is read again as it is picked: `now` may be most of a
    // minute old, and "45m" means 45 minutes from the pick.
    const until = choice.icon === "typed" ? whenOf(text, moment) : undefined
    const picks = until === undefined ? choice.picks : { until }
    const gone = passedAt({ ...choice, picks }, moment)
    if (gone === undefined) onPick(picks)
    else setPassed(gone)
  }
  return (
    <>
      <div className="truncate px-1.5 pt-0.5 pb-1.5 text-xs text-muted-foreground">
        Later · <span className="text-foreground/80">{listed.title}</span>
      </div>
      {listed.mark === "asking" && (
        <p className="px-1.5 pb-1.5 text-xs text-muted-foreground">
          It waits with its question
        </p>
      )}
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
          setPassed(undefined)
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            const by = event.key === "ArrowDown" ? 1 : -1
            setAt((picked + by + choices.length) % choices.length)
          } else if (event.key === "Enter") {
            event.preventDefault()
            const choice = choices[picked]
            if (choice) pick(choice)
          }
        }}
      />
      {passed !== undefined ? (
        <p
          role="status"
          className="px-1.5 pt-1.5 text-xs text-muted-foreground"
        >
          {clock(passed, now)} has passed. Pick another time.
        </p>
      ) : (
        text.trim() &&
        typed === undefined && (
          <p className="px-1.5 pt-1.5 text-xs text-muted-foreground">
            Not a time yet: try 45m, 3h, 18, tomorrow 10, fri.
          </p>
        )
      )}
      <SuggestionList aria-label="When" className="mt-1">
        {choices.map((choice, index) => (
          <Suggestion
            key={`${choice.label}${choice.note}`}
            id={`${id}-${index}`}
            selected={index === picked}
            className={cn(
              "px-1.5",
              // A gap and a hairline, drawn by the line itself, so the
              // list holds nothing but its options.
              choice.apart &&
                "relative mt-2 before:pointer-events-none before:absolute before:-inset-x-1.5 before:-top-1 before:h-px before:bg-border"
            )}
            onPointerMove={() => setAt(index)}
            onClick={() => pick(choice)}
          >
            {(iconed || choice.icon) && (
              <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5">
                {choice.icon && ICONS[choice.icon]}
              </span>
            )}
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
