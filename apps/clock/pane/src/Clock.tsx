import { Button } from "@banda/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { useMinute } from "@banda/ui/hooks/use-now"
import { cn } from "@banda/ui/lib/utils"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useMemo, useState } from "react"
import {
  type Day,
  dayTitle,
  firstDay,
  isoWeek,
  type Month,
  monthTitle,
  said,
  sameDay,
  shifted,
  today,
  weekdays,
  weeksOf,
} from "./month"

/**
 * The clock on the bar: the day, in the bar's muted text, and the time,
 * in the text's own, by this device's clock and language. A click shows
 * the month, today on a faint fill, each week with its number; its
 * arrows go a month back and on, and Today comes back.
 */
export function ClockWidget() {
  // Drawn again as each minute begins, not up to one late.
  const at = useMinute()
  const words = useMemo(() => said(at), [at])
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`${words.whole}, ${words.time}`}
            title={words.whole}
            className="flex h-6 items-center gap-2 rounded-control px-2 text-xs text-muted-foreground tabular-nums outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted data-popup-open:text-foreground"
          />
        }
      >
        <span>{words.day}</span>
        <span className="text-foreground">{words.time}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2.5" sideOffset={6}>
        {open && <Calendar day={today(at)} />}
      </PopoverContent>
    </Popover>
  )
}

/** The month, from today's, which the arrows move from. */
function Calendar({ day }: { day: Day }) {
  const [shown, setShown] = useState<Month>(day)
  const first = useMemo(() => firstDay(), [])
  const names = useMemo(() => weekdays(first), [first])
  const weeks = useMemo(() => weeksOf(shown, first), [shown, first])
  const away = shown.year !== day.year || shown.month !== day.month
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-0.5 pb-1 pl-1.5">
        <span className="mr-auto text-sm font-semibold first-letter:uppercase">
          {monthTitle(shown)}
        </span>
        {away && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground"
            onClick={() => setShown(day)}
          >
            Today
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous month"
          title="Previous month"
          onClick={() => setShown((month) => shifted(month, -1))}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next month"
          title="Next month"
          onClick={() => setShown((month) => shifted(month, 1))}
        >
          <ChevronRightIcon />
        </Button>
      </div>
      <div
        role="grid"
        aria-label={monthTitle(shown)}
        className="grid grid-cols-[1.375rem_repeat(7,2.25rem)] gap-y-px text-center text-[0.78rem] tabular-nums"
      >
        <span />
        {names.map((name) => (
          <span
            key={name}
            className="grid h-5.5 place-items-center text-[0.6875rem] text-muted-foreground"
          >
            {name}
          </span>
        ))}
        {weeks.map((week) => (
          <Row key={week.number} week={week} day={day} />
        ))}
      </div>
      <div className="mt-1 flex gap-1.5 border-t border-border px-2 pt-2 pb-0.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground first-letter:uppercase">
          {dayTitle(day)}
        </span>
        <span className="ml-auto">week {isoWeek(day)}</span>
      </div>
    </div>
  )
}

function Row({
  week,
  day,
}: {
  week: ReturnType<typeof weeksOf>[number]
  day: Day
}) {
  return (
    <>
      <span className="grid h-7.5 place-items-center text-[0.65rem] text-muted-foreground/70">
        {week.number}
      </span>
      {week.days.map(({ day: one, out }) => (
        <span
          key={`${one.month}-${one.date}`}
          aria-current={sameDay(one, day) ? "date" : undefined}
          className={cn(
            "grid h-7.5 place-items-center rounded-small",
            out && "text-muted-foreground/60",
            // Today calls for nothing: a faint fill, as the workspace shown.
            sameDay(one, day) && "bg-foreground/12 font-semibold"
          )}
        >
          {one.date}
        </span>
      ))}
    </>
  )
}
