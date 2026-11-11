/**
 * "How" in a Thread's row (ADR 0114, decisions 5 and 6): the model it
 * runs on, its effort lighter beside it, and a bolt while Fast mode is
 * on. Its menu: the menu of models, "All models", the effort's levels,
 * Fast mode and the way back to the Harness's defaults. "All models"
 * opens {@link AllModels} over the Pane. It draws {@link How} and says
 * the one thing chosen.
 */
import { useEffect, useEffectEvent, useRef, useState } from "react"
import { Button } from "@banda/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { cn } from "@banda/ui/lib/utils"
import {
  CheckIcon,
  ChevronRightIcon,
  LayoutGridIcon,
  RotateCcwIcon,
  StarIcon,
  XIcon,
  ZapIcon,
} from "lucide-react"
import { FOOTER_CONTROL } from "./footer"
import type { How, HowModel } from "./how"

/** What the picker says was chosen. */
export type HowActs = {
  onModel: (value: string) => void
  onLevel: (value: string) => void
  onFast: (on: boolean) => void
  onReset: () => void
  /** Stars a model, or takes its star back. */
  onStar: (value: string) => void
  /** Opens the window of all models. */
  onAll: () => void
}

export function HowPicker({
  how,
  disabled,
  ...acts
}: { how: How; disabled: boolean } & HowActs) {
  const [open, setOpen] = useState(false)
  const { model, level, fast, name } = how
  const what = model ?? name
  const label = [what, level?.name, fast?.on && fast.name]
    .filter(Boolean)
    .join(", ")
  const close =
    <T,>(act: (value: T) => void) =>
    (value: T) => {
      setOpen(false)
      act(value)
    }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn("min-w-0", FOOTER_CONTROL)}
            aria-label={`Model: ${label}`}
          />
        }
      >
        <span className="truncate">{what}</span>
        {level && (
          <span
            data-top={level.top || undefined}
            className={cn(
              "shrink-0",
              level.top ? "text-effort-top" : "opacity-70"
            )}
          >
            {level.name}
          </span>
        )}
        {fast?.on && <ZapIcon aria-hidden fill="currentColor" />}
      </PopoverTrigger>
      {/* It floats as the chat's popups do (ADR 0058): a block's corner. */}
      <PopoverContent
        side="top"
        align="end"
        className="w-72 gap-0 rounded-card p-1"
      >
        <Heading>Model</Heading>
        {how.all.length === 0 ? (
          <p className="px-2.5 pb-1.5 text-meta text-muted-foreground">
            {name} says its models once it has run a Thread. This one starts on
            its default.
          </p>
        ) : (
          <>
            <div role="listbox" aria-label="Model">
              {how.menu.map((one) => (
                <ModelRow
                  key={one.value}
                  model={one}
                  quiet
                  onPick={close(acts.onModel)}
                  onStar={acts.onStar}
                />
              ))}
            </div>
            <Item
              icon={<LayoutGridIcon />}
              name="All models"
              about={String(how.all.length)}
              end={
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              }
              onClick={() => close(acts.onAll)(undefined)}
            />
          </>
        )}
        {how.levels.length > 0 && (
          <>
            <Rule />
            <Heading>Effort</Heading>
            <div
              role="radiogroup"
              aria-label="Effort"
              className="mx-2 mt-0.5 mb-1.5 grid auto-cols-fr grid-flow-col gap-0.5 rounded-control bg-foreground/6 p-0.5"
            >
              {how.levels.map((one) => (
                <button
                  key={one.value}
                  type="button"
                  role="radio"
                  aria-checked={one.on}
                  className={cn(
                    "h-6.5 rounded-small text-meta text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    one.on &&
                      "bg-popover font-medium text-foreground ring-1 ring-border",
                    one.top && "text-effort-top"
                  )}
                  onClick={() => acts.onLevel(one.value)}
                >
                  {one.name}
                </button>
              ))}
            </div>
          </>
        )}
        {fast && (
          <Item
            icon={<ZapIcon />}
            name={fast.name}
            about={fast.about}
            role="switch"
            checked={fast.on}
            end={<Knob on={fast.on} />}
            onClick={() => acts.onFast(!fast.on)}
          />
        )}
        {how.reset && (
          <>
            <Rule />
            <Item
              icon={<RotateCcwIcon />}
              name={`Back to ${name}'s defaults`}
              onClick={() => close(acts.onReset)(undefined)}
            />
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Every model of the Thread's Harness, in a window over the Pane, the
 * Thread dimmed under it (ADR 0114, decision 6): the starred, then the
 * rest. A click chooses the model; the quiet star puts it in the menu or
 * takes it out. Arrows and Enter work in it, and Esc closes it.
 */
export function AllModels({
  how,
  title,
  onModel,
  onStar,
  onClose,
}: {
  how: How
  /** What its Harness's accounts are grouped under: `Claude Code`. */
  title: string
  onModel: (value: string) => void
  onStar: (value: string) => void
  onClose: () => void
}) {
  const list = useRef<HTMLDivElement>(null)
  const close = useEffectEvent(onClose)
  // Its keys are the window's while it is open: the menu that opened it
  // gives the focus back to its trigger as it closes.
  useEffect(() => {
    const first = () => {
      const rows = picks(list.current)
      ;(rows.find((row) => row.ariaSelected === "true") ?? rows[0])?.focus()
    }
    const later = setTimeout(first)
    const onKey = (event: KeyboardEvent) => {
      const by = { ArrowDown: 1, ArrowUp: -1 }[event.key]
      if (event.key !== "Escape" && by === undefined) return
      event.preventDefault()
      event.stopPropagation()
      if (by === undefined) close()
      else if (list.current?.contains(document.activeElement))
        step(list.current, by)
      else first()
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      clearTimeout(later)
      window.removeEventListener("keydown", onKey, true)
    }
  }, [])
  const pick = (value: string) => {
    onClose()
    onModel(value)
  }
  return (
    <div
      className="absolute inset-0 z-float grid place-items-center bg-desk/55"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal
        aria-label="Models"
        className="flex max-h-[calc(100%-3rem)] w-[min(28.75rem,calc(100%-2rem))] flex-col rounded-card bg-popover shadow-float ring-1 ring-foreground/12"
      >
        <div className="flex items-center gap-2 px-3.5 pt-3 pb-1 font-semibold">
          Models
          <span className="rounded-small px-1.5 text-small font-normal text-muted-foreground ring-1 ring-border">
            {title}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto text-muted-foreground"
            aria-label="Close"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>
        <div
          ref={list}
          role="listbox"
          aria-label="Models"
          className="overflow-y-auto p-1"
        >
          {how.starred.length > 0 && (
            <Section name="In the menu" count={how.starred.length}>
              {how.starred.map((one) => (
                <ModelRow
                  key={one.value}
                  model={one}
                  onPick={pick}
                  onStar={onStar}
                />
              ))}
            </Section>
          )}
          {how.rest.length > 0 && (
            <Section name={`All of ${title}'s`} count={how.rest.length}>
              {how.rest.map((one) => (
                <ModelRow
                  key={one.value}
                  model={one}
                  onPick={pick}
                  onStar={onStar}
                />
              ))}
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

/** The rows a list's arrows move between. */
function picks(list: HTMLElement | null): HTMLElement[] {
  return [...(list?.querySelectorAll<HTMLElement>("[role=option]") ?? [])]
}

function step(list: HTMLElement | null, by: number) {
  const rows = picks(list)
  const at = rows.indexOf(document.activeElement as HTMLElement)
  rows[Math.min(rows.length - 1, Math.max(0, at + by))]?.focus()
}

function Section({
  name,
  count,
  children,
}: {
  name: string
  count: number
  children: React.ReactNode
}) {
  return (
    <div role="group" aria-label={name}>
      <div className="flex justify-between px-2.5 pt-2 pb-1 text-meta font-medium text-muted-foreground">
        <span>{name}</span>
        <span className="tabular-nums">{count}</span>
      </div>
      {children}
    </div>
  )
}

/** A model: its name and what it is for, a check while the Thread runs
 * on it, and its star. In the menu a star shows only on hover, as all
 * there are starred. */
function ModelRow({
  model,
  quiet,
  onPick,
  onStar,
}: {
  model: HowModel
  quiet?: boolean
  onPick: (value: string) => void
  onStar: (value: string) => void
}) {
  const { value, name, about, on, starred } = model
  return (
    <div className="group/row flex items-center rounded-control hover:bg-accent has-focus-visible:bg-accent">
      <button
        type="button"
        role="option"
        aria-selected={on}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pl-2.5 text-left outline-none"
        onClick={() => onPick(value)}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{name}</span>
          {about && (
            <span className="truncate text-meta text-muted-foreground">
              {about}
            </span>
          )}
        </span>
        <CheckIcon
          aria-hidden
          className={cn("size-4 shrink-0", !on && "invisible")}
        />
      </button>
      <button
        type="button"
        aria-label={
          starred ? `Take ${name} out of the menu` : `Keep ${name} in the menu`
        }
        aria-pressed={starred}
        tabIndex={-1}
        className={cn(
          "mx-1 grid size-5.5 shrink-0 place-items-center rounded-small text-muted-foreground/55 hover:bg-foreground/10 hover:text-foreground",
          starred && "text-muted-foreground",
          quiet && "invisible group-hover/row:visible"
        )}
        onClick={() => onStar(value)}
      >
        <StarIcon
          className="size-3.25"
          fill={starred ? "currentColor" : "none"}
        />
      </button>
    </div>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pt-2 pb-1 text-meta font-medium text-muted-foreground">
      {children}
    </div>
  )
}

function Rule() {
  return <div className="mx-1.5 my-1 h-px bg-border" />
}

function Item({
  icon,
  name,
  about,
  end,
  role,
  checked,
  onClick,
}: {
  icon: React.ReactNode
  name: string
  about?: string
  end?: React.ReactNode
  role?: "switch"
  checked?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={checked}
      className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-1.5 text-left text-ui outline-none hover:bg-accent focus-visible:bg-accent [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground"
      onClick={onClick}
    >
      {icon}
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="shrink-0">{name}</span>
        {about && (
          <span className="truncate text-meta text-muted-foreground">
            {about}
          </span>
        )}
      </span>
      {end}
    </button>
  )
}

/** A switch's look, inside the row that is the switch. */
function Knob({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative h-4 w-7 shrink-0 rounded-full transition-colors",
        on ? "bg-foreground" : "bg-foreground/16"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 size-3 rounded-full bg-popover shadow-float transition-transform",
          on && "translate-x-3"
        )}
      />
    </span>
  )
}
