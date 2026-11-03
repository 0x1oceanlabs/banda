import { useState } from "react"
import type {
  HarnessOption,
  OptionValue,
  Settings,
} from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import { HarnessLogo } from "@banda/ui/components/harness-logo"
import { LevelSlider, levelTone } from "@banda/ui/components/level-slider"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { cn } from "@banda/ui/lib/utils"
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RotateCcwIcon,
  ZapIcon,
} from "lucide-react"
import { levelAt, levelsOf, modelName, resetOf, type Picked } from "./picker"
import { choose, chosen } from "./thread"

/**
 * The model a Thread runs on and how hard it thinks, as one quiet trigger
 * beside the send button, as Codex has it: the Harness's logo, the model,
 * the effort. It opens on a slider of effort levels, with Fast mode and a
 * way back to the Harness's defaults beside the model's name, which opens
 * the list of models.
 */
export function ModelPicker({
  harness,
  name,
  settings,
  picked,
  disabled,
  onChange,
}: {
  /** The Harness's id, for its logo, and its name. */
  harness: string
  name: string
  settings: Settings
  picked: Picked
  disabled: boolean
  onChange: (settings: Settings) => void
}) {
  const { model, effort, fast } = picked
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<"levels" | "models">("levels")
  // The level under the thumb while it is dragged, before it is chosen.
  const [sliding, setSliding] = useState<number>()
  if (!model && !effort) return null

  const value = model && String(chosen(settings, model))
  const now = model?.choices.find((choice) => choice.value === value)
  const levels = effort ? levelsOf(effort) : []
  const chosenLevel = levelAt(settings, effort)
  const at = sliding ?? chosenLevel.at
  const unset = chosenLevel.unset && sliding === undefined
  const level = unset ? undefined : levels[at]
  const reset = resetOf(settings, picked)
  const logo = <HarnessLogo id={harness} name={name} fallback={null} />
  const named = (
    <>
      {now && <span className="truncate">{modelName(now)}</span>}
      {level && (
        <span className={cn("shrink-0", levelTone(at, levels.length - 1))}>
          {level.name}
        </span>
      )}
    </>
  )
  const label = [now && modelName(now), level?.name].filter(Boolean).join(", ")
  // Only a change goes to the Harness: each is a round trip to it.
  const pick = (option: HarnessOption, next: OptionValue) => {
    setSliding(undefined)
    if (next !== chosen(settings, option))
      onChange(choose(settings, option.id, next))
  }
  const shown = effort ? view : "models"

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setView("levels")
        setSliding(undefined)
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 font-normal text-foreground/75"
            aria-label={`Model: ${label}`}
          />
        }
      >
        {logo}
        {named}
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-72 gap-0 p-1">
        {shown === "levels" && effort ? (
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
              onSlide={setSliding}
              onChoose={(index) => pick(effort, levels[index].value)}
            />
          </>
        ) : (
          model && (
            <Models
              option={model}
              value={value}
              logo={logo}
              onBack={effort && (() => setView("levels"))}
              onChoose={(next) => {
                setOpen(false)
                pick(model, next)
              }}
            />
          )
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
        on ? "text-(--ansi-4)" : "text-muted-foreground"
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

/** The Harness's models, each under its logo with what it is for. */
function Models({
  option,
  value,
  logo,
  onBack,
  onChoose,
}: {
  option: HarnessOption
  value?: string
  logo: React.ReactNode
  onBack?: () => void
  onChoose: (value: string) => void
}) {
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
        <span className={cn(!onBack && "px-1.5")}>{option.name}</span>
      </div>
      <div
        role="listbox"
        aria-label={option.name}
        className="max-h-80 overflow-y-auto"
      >
        {option.choices.map((choice) => {
          const on = choice.value === value
          return (
            <button
              key={choice.value}
              type="button"
              role="option"
              aria-selected={on}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent",
                on && "bg-accent/60"
              )}
              onClick={() => onChoose(choice.value)}
            >
              {logo}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{choice.name}</span>
                {choice.description && (
                  <span className="truncate text-xs text-muted-foreground">
                    {choice.description}
                  </span>
                )}
              </span>
              {on && <CheckIcon className="size-4 shrink-0" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
