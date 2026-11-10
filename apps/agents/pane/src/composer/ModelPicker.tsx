import { useState } from "react"
import type {
  HarnessOption,
  Offer,
  OptionValue,
  Settings,
} from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import { Emblem, emblemOf, type EmblemOf } from "@banda/ui/components/emblem"
import { LevelSlider } from "@banda/ui/components/level-slider"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { cn } from "@banda/ui/lib/utils"
import { clock } from "@banda/core/react"
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RotateCcwIcon,
  ZapIcon,
} from "lucide-react"
import {
  levelAt,
  levelsOf,
  modelName,
  pickedOf,
  resetOf,
  type Picked,
} from "./picker"
import { harnessTitle } from "../harnesses"
import { choose, chosen } from "../thread/state"
import type { Move } from "../thread/moves"
import { MoveConfirm, MoveList } from "./Moves"
import { FOOTER_CONTROL } from "./Composer"

/**
 * The model a Thread runs on and how hard it thinks, as one quiet trigger
 * beside the send button, as Codex has it: the Harness's logo, the model,
 * the effort lighter beside it, in words rather than colours (ADR 0058,
 * decision 8). It opens on a slider of effort levels, with Fast mode and a
 * way back to the Harness's defaults beside the model's name, which opens
 * the list of models. A new Thread's list holds every Harness's models,
 * each under its logo: choosing one chooses the Harness too. A started
 * Thread's lists, under the slider, the accounts and Harnesses it may
 * move to (ADR 0078).
 */
export function ModelPicker({
  harness,
  name,
  settings,
  picked,
  disabled,
  onChange,
  starts,
  out,
  onStart,
  harnesses,
  moves,
  onMove,
}: {
  /** The Harness's id, for its emblem, and its name. */
  harness: string
  name: string
  /** The Harness list, whose entries' emblems it draws. */
  harnesses: readonly EmblemOf[]
  settings: Settings
  picked: Picked
  disabled: boolean
  /** Whether the settings were accepted; a refusal restores the old level. */
  onChange: (settings: Settings) => Promise<boolean>
  /** A new Thread's Harnesses, if it can start on another. */
  starts?: Start[]
  /** The account a new Thread starts on is out, till `until` when that is
   * said: the trigger warns, and the popover says the reset. */
  out?: { until?: number }
  /** Starts the new Thread on another Harness, with `settings`. */
  onStart?: (harness: string, settings?: Settings) => void
  /** A started Thread's moves, and whether a move to another Harness
   * asks first: once per Thread. */
  moves?: { same: Move[]; others: Move[]; confirm: boolean }
  /** Moves the Thread. */
  onMove?: (move: Move) => void
}) {
  const { model, effort, fast } = picked
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<"levels" | "models">("levels")
  const [confirming, setConfirming] = useState<Move>()
  // Keep the preview through the configure round trip. New settings
  // replace it; clearing it on release would animate back to the old level.
  const [sliding, setSliding] = useState<{ settings: Settings; at: number }>()
  const others = starts && starts.length > 1 ? starts : undefined
  const movable = !!moves && (moves.same.length > 1 || moves.others.length > 0)
  if (!model && !effort && !others && !movable) return null

  const value = model && String(chosen(settings, model))
  const now = model?.choices.find((choice) => choice.value === value)
  const levels = effort ? levelsOf(effort) : []
  const chosenLevel = levelAt(settings, effort)
  const preview = sliding?.settings === settings ? sliding.at : undefined
  const at = preview ?? chosenLevel.at
  const unset = chosenLevel.unset && preview === undefined
  const level = unset ? undefined : levels[at]
  const reset = resetOf(settings, picked)
  const logo = <Emblem of={emblemOf(harnesses, harness, name)} />
  // A Harness that has not said its models yet goes by its own name.
  const what = now ? modelName(now) : level ? undefined : name
  const named = (
    <>
      {what && <span className="truncate">{what}</span>}
      {level && <span className="shrink-0 opacity-70">{level.name}</span>}
    </>
  )
  const label = [what, level?.name].filter(Boolean).join(", ")
  // Only a change goes to the Harness: each is a round trip to it.
  const pick = async (option: HarnessOption, next: OptionValue) => {
    if (next === chosen(settings, option)) {
      setSliding(undefined)
      return
    }
    if (!(await onChange(choose(settings, option.id, next))))
      setSliding(undefined)
  }
  const shown = effort ? view : "models"
  const moveTo = (move: Move) => {
    if (move.on) return
    if (!move.same && moves?.confirm) {
      setConfirming(move)
      return
    }
    setOpen(false)
    onMove?.(move)
  }
  const list = moves && (
    <MoveList
      same={moves.same}
      others={moves.others}
      harnessName={harnessTitle(
        harnesses,
        emblemOf(harnesses, harness).harness
      )}
      onPick={moveTo}
    />
  )
  // The models: this Harness's alone; for a new Thread, every Harness's.
  const groups: Group[] = (others ?? [undefined]).map((start) => {
    if (!start || start.id === harness)
      return {
        id: harness,
        name,
        model,
        value,
        choose: (next) => model && next !== undefined && pick(model, next),
      }
    const theirs = pickedOf(start.offer.options).model
    return {
      id: start.id,
      name: start.name,
      model: theirs,
      choose: (next) =>
        onStart?.(
          start.id,
          theirs && next !== undefined
            ? choose(start.settings, theirs.id, next)
            : undefined
        ),
    }
  })

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setView("levels")
        setConfirming(undefined)
        setSliding(undefined)
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn("min-w-0", FOOTER_CONTROL)}
            aria-label={`Model: ${label}${out ? `, ${name} is out of its limits` : ""}`}
          />
        }
      >
        {logo}
        {named}
        {out && (
          <span
            aria-hidden
            className="-ml-0.5 size-1.5 shrink-0 self-start rounded-full bg-warning"
          />
        )}
      </PopoverTrigger>
      {/* It floats as the chat's popups do (ADR 0058): a block's corner. */}
      <PopoverContent
        side="top"
        align="end"
        className="w-72 gap-0 rounded-card p-1"
      >
        {out && !confirming && (
          <p className="px-2.5 pt-1.5 pb-1 text-xs text-warning">
            {name} is out of its limits
            {out.until === undefined ? "" : ` until ${clock(out.until)}`}. A
            fallback in Settings → Agents starts new Threads there meanwhile.
          </p>
        )}
        {confirming ? (
          <MoveConfirm
            move={confirming}
            from={name}
            onCancel={() => setConfirming(undefined)}
            onMove={() => {
              setOpen(false)
              setConfirming(undefined)
              onMove?.(confirming)
            }}
          />
        ) : shown === "levels" && effort ? (
          <>
            <div className="relative flex h-9 items-center justify-center px-9">
              {fast && (
                <FastToggle
                  option={fast}
                  on={chosen(settings, fast) === true}
                  onChange={(on) => pick(fast, on)}
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                className="min-w-0 gap-1.5"
                disabled={!model}
                aria-label="Models"
                onClick={() => setView("models")}
              >
                {logo}
                {named}
                {model && (
                  <ChevronRightIcon className="text-muted-foreground" />
                )}
              </Button>
              {reset && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-0 text-muted-foreground"
                  aria-label={`${name}'s defaults`}
                  title={`${name}'s defaults`}
                  onClick={() => {
                    setSliding(undefined)
                    onChange(reset)
                  }}
                >
                  <RotateCcwIcon />
                </Button>
              )}
            </div>
            <LevelSlider
              names={levels.map((level) => level.name)}
              label="Effort"
              at={at}
              unset={unset}
              onSlide={(at) => setSliding({ settings, at })}
              onChoose={(index) => pick(effort, levels[index].value)}
            />
            {list}
          </>
        ) : (
          <>
            <Models
              harnesses={harnesses}
              groups={groups}
              current={harness}
              onBack={effort && (() => setView("levels"))}
              onChoose={(group, next) => {
                setOpen(false)
                group.choose(next)
              }}
            />
            {!effort && list}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

function FastToggle({
  option,
  on,
  onChange,
}: {
  option: HarnessOption
  on: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(
        "absolute left-0",
        on ? "text-foreground" : "text-muted-foreground"
      )}
      aria-label={option.name}
      aria-pressed={on}
      title={option.description ?? option.name}
      onClick={() => onChange(!on)}
    >
      <ZapIcon fill={on ? "currentColor" : "none"} />
    </Button>
  )
}

/** What a new Thread on a Harness would start with. */
export type Start = {
  id: string
  name: string
  settings: Settings
  offer: Offer
}

/** One Harness's models in the list, and what choosing one of them, or
 * the Harness itself when it has not said its models, does. */
type Group = {
  id: string
  name: string
  model?: HarnessOption
  value?: string
  choose: (value?: string) => void
}

/** The models, each with what it is for: one Harness's, each under its
 * logo, or each Harness's under its logo and name. */
function Models({
  groups,
  current,
  onBack,
  onChoose,
  harnesses,
}: {
  harnesses: readonly EmblemOf[]
  groups: Group[]
  current: string
  onBack?: () => void
  onChoose: (group: Group, value?: string) => void
}) {
  const headed = groups.length > 1
  return (
    <div className="flex flex-col">
      <div className="flex h-8 items-center gap-1 px-1 text-xs text-muted-foreground">
        {onBack && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Back to effort"
            onClick={onBack}
          >
            <ChevronLeftIcon />
          </Button>
        )}
        <span className={cn(!onBack && "px-1.5")}>Model</span>
      </div>
      <div
        role="listbox"
        aria-label="Model"
        className="max-h-80 overflow-y-auto"
      >
        {groups.map((group, i) => {
          // Beside its name, the logo only decorates the row.
          const logo = (
            <span aria-hidden className="contents">
              <Emblem of={emblemOf(harnesses, group.id, group.name)} />
            </span>
          )
          const here = group.id === current
          return (
            <div key={group.id} role="group" aria-label={group.name}>
              {headed && group.model && (
                <div
                  className={cn(
                    "flex items-center gap-2 px-2.5 pt-2 pb-1 text-xs text-muted-foreground",
                    i > 0 && "mt-1 border-t border-border/60"
                  )}
                >
                  {logo}
                  {group.name}
                </div>
              )}
              {group.model ? (
                group.model.choices.map((choice) => (
                  <Row
                    key={choice.value}
                    name={choice.name}
                    about={choice.description}
                    logo={!headed && logo}
                    on={here && choice.value === group.value}
                    onClick={() => onChoose(group, choice.value)}
                  />
                ))
              ) : (
                <Row
                  name={group.name}
                  about="Models show after its first Thread"
                  logo={logo}
                  on={here}
                  onClick={() => onChoose(group)}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Row({
  name,
  about,
  logo,
  on,
  onClick,
}: {
  name: string
  about?: string
  logo?: React.ReactNode
  on: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={on}
      className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
      onClick={onClick}
    >
      {logo}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{name}</span>
        {about && (
          <span className="truncate text-xs text-muted-foreground">
            {about}
          </span>
        )}
      </span>
      {on && <CheckIcon className="size-4 shrink-0" />}
    </button>
  )
}
