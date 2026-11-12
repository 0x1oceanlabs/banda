/**
 * A machine's name and icon, as Settings → Machines edits them (ADR 0095,
 * decisions 1 and 9): its name in a field, up to 16 characters; the ten
 * icons, those other machines have greyed and still taken; and how it
 * shows, on a label (the full form) and on a row (the compact form, after
 * the Project). The name is written on Enter or as the field loses the
 * focus, an icon as it is picked; where, the caller says.
 */
import { useState } from "react"
import type { ProjectSummary } from "@banda/contract"
import type { MachineIcon as Icon, Named } from "@banda/contract/machines"
import { Input } from "@banda/ui/components/input"
import { MachineIcon, MachineMark } from "@banda/ui/components/machine-icon"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { cn } from "@banda/ui/lib/utils"
import { ICON_WORDS, ICONS, NAME_MOST } from "./machines"

export function MachinePicker({
  named,
  about,
  taken,
  project,
  disabled,
  onName,
  onIcon,
}: {
  /** Its name and icon now. */
  named: Named
  /** Where they are written, under the title. */
  about: string
  /** The names of the other machines that have each icon. */
  taken: ReadonlyMap<Icon, readonly string[]>
  /** A Project of its, for the row's preview. */
  project?: ProjectSummary
  disabled?: boolean
  /** Writes its name; an empty one goes back to what Banda finds. */
  onName: (name: string) => void
  onIcon: (icon: Icon) => void
}) {
  // What the field holds, for the preview, until its name is written.
  const [draft, setDraft] = useState<{ was: string; text: string }>()
  const text = draft && draft.was === named.name ? draft.text : named.name
  const shown = { name: text.trim() || named.name, icon: named.icon }
  const commit = () => {
    if (text.trim() !== named.name) onName(text.trim())
  }
  const holders = [
    ...new Set(
      ICONS.filter((icon) => icon !== named.icon).flatMap(
        (icon) => taken.get(icon) ?? []
      )
    ),
  ]
  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <div className="text-ui font-medium">Name and icon</div>
        <div className="text-meta text-muted-foreground">{about}</div>
      </div>
      <Input
        aria-label="Machine name"
        value={text}
        maxLength={NAME_MOST}
        disabled={disabled}
        autoFocus
        onChange={(event) =>
          setDraft({ was: named.name, text: event.target.value })
        }
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit()
        }}
      />
      <div
        role="radiogroup"
        aria-label="Machine icon"
        className="grid grid-cols-5 gap-1"
      >
        {ICONS.map((icon) => {
          const on = icon === named.icon
          const has = taken.get(icon) ?? []
          return (
            <button
              key={icon}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={ICON_WORDS[icon]}
              title={
                has.length > 0
                  ? `${ICON_WORDS[icon]} · ${has.join(", ")} has it`
                  : ICON_WORDS[icon]
              }
              disabled={disabled}
              data-taken={has.length > 0 || undefined}
              onClick={() => !on && onIcon(icon)}
              className={cn(
                "flex aspect-square items-center justify-center rounded-control text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none",
                on && "bg-accent text-foreground ring-1 ring-ring",
                !on && has.length > 0 && "opacity-40"
              )}
            >
              <MachineIcon icon={icon} size={20} />
            </button>
          )
        })}
      </div>
      {holders.length > 0 && (
        <p className="text-meta text-muted-foreground">
          Grey: another machine has it ({holders.join(", ")}).
        </p>
      )}
      <div
        aria-label="How it shows"
        className="flex flex-col gap-1.5 rounded-control border px-2.5 py-2 text-meta"
      >
        <div className="flex items-center gap-2">
          <span className="w-10 shrink-0 text-muted-foreground">Label</span>
          <MachineMark named={shown} form="full" />
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="w-10 shrink-0 text-muted-foreground">Row</span>
          <span className="flex min-w-0 items-center gap-1.5">
            {project && <ProjectSign project={project} size={14} />}
            <span className="truncate">{project?.name ?? "Project"}</span>
            <MachineMark named={shown} form="compact" />
          </span>
        </div>
      </div>
    </div>
  )
}
