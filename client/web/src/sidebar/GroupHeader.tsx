import {
  BandaMark,
  callColor,
  MARK_WORDS,
} from "@banda/ui/components/banda-mark"
import { Button } from "@banda/ui/components/button"
import { MachineIcon } from "@banda/ui/components/machine-icon"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { useHereNamed, useShownOf } from "@banda/core/react"
import { NO_PROJECT } from "@banda/ui/lib/projects"
import { cn } from "@banda/ui/lib/utils"
import { ChevronRightIcon, EllipsisIcon } from "lucide-react"
import { useState } from "react"
import { TONES } from "./CardStatus"
import { HOVER_FILL } from "./CardView"
import type { GroupBlock } from "./regions"
import type { Settings } from "./settings"
import { pickProps } from "./usePick"

/**
 * A group's header in the sidebar list (ADR 0098, decision 7): its sign,
 * its name and a chevron that folds it, turning over 150 ms; on the right
 * its rollup, how many wait for the Person in the colour of the loudest
 * call and how many work in grey, and, folded, the loudest one's mark
 * too. The pointer over it, or the keyboard's focus in it, shows **⋯**,
 * the Project's menu its right click opens, in the rollup's place
 * (decision 16); no **+**: the sidebar starts no Thread (Roma,
 * 2026-11-12). A machine's group has the machine's icon and name. Another
 * machine's Project has no menu yet: each act would go to this machine's
 * engine. Inside the list, which keys pick (decision 13), none of it is a
 * Tab stop: the header is a stop of the pick (`stop`), folded or not,
 * which ← folds and → or Enter unfolds, Enter folding it again; Shift+F10
 * or the Menu key on it opens the Project's menu, as ⋯ does, and picked
 * by a key it shows ⋯ too.
 */
export function GroupHeader({
  group,
  settings,
  stop,
  picked = false,
  onFold,
}: {
  group: GroupBlock
  settings: Settings
  /** Its key as a stop of the pick. */
  stop: string
  /** The list's keys act on it. */
  picked?: boolean
  onFold: () => void
}) {
  const { project, folded } = group
  const byProject = group.by === "project"
  // ⋯ is this machine's Projects' alone.
  const menu = byProject && group.host === undefined && project !== undefined
  const tone = callColor(group.mark)
  // A click that folds or unfolds keeps the rollup in sight until the
  // pointer leaves the header (`globals.css`).
  const [clicked, setClicked] = useState(false)
  return (
    <div
      data-head=""
      data-clicked={clicked ? "" : undefined}
      onPointerLeave={() => setClicked(false)}
      className={cn(
        "relative isolate flex h-7 items-center gap-1.5 rounded-control px-2 text-ui",
        // The hover's fill, as a card's (by plain :hover, as the cards'
        // acts).
        HOVER_FILL
      )}
    >
      <button
        type="button"
        aria-expanded={!folded}
        data-group={group.key}
        {...pickProps(stop, picked)}
        tabIndex={-1}
        title={project?.folder}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-control text-left outline-none"
        // The focus stays where it was: on the list, or in a Pane.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setClicked(true)
          onFold()
        }}
      >
        {byProject ? (
          <ProjectSign project={project} size={14} />
        ) : (
          <MachineName host={group.host} />
        )}
        {byProject && (
          <span
            className={cn(
              "min-w-0 truncate",
              project ? "font-medium" : "text-muted-foreground"
            )}
          >
            {project?.name ?? NO_PROJECT}
          </span>
        )}
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-muted-foreground/50 transition-transform duration-150 ease-(--ease)",
            !folded && "rotate-90"
          )}
        />
      </button>
      {/* What waits for the Person, the loudest's mark while folded, then
        how many work, in grey; under the pointer, or with the keyboard's
        focus in the header, the acts in its place, which it keeps room
        for. A click that folds leaves the rollup in sight. */}
      <span
        data-head-rollup={menu ? "" : undefined}
        className={cn(
          "flex shrink-0 items-center justify-end gap-1.5 text-meta tabular-nums",
          menu && "min-w-5"
        )}
      >
        {settings.projects.rollup && folded && tone && (
          <BandaMark
            variant="agent"
            state={group.mark}
            playful={0}
            label={MARK_WORDS[group.mark]}
            className="size-3.5"
          />
        )}
        {settings.projects.rollup && group.waiting > 0 && (
          <span
            aria-label={`${group.waiting} waiting`}
            className={cn("font-semibold", tone && TONES[tone])}
          >
            {group.waiting}
          </span>
        )}
        {group.working > 0 && (
          <span
            aria-label={`${group.working} working`}
            className="text-muted-foreground/60"
          >
            {group.working}
          </span>
        )}
      </span>
      {menu && (
        <span
          data-head-acts=""
          className="absolute inset-y-0 right-2 flex items-center"
        >
          <Button
            variant="ghost"
            size="icon-xs"
            tabIndex={-1}
            className="size-5 text-muted-foreground [&_svg]:size-3.5"
            aria-label={`${project.name} menu`}
            title="Project menu"
            // The menu its right click opens, at the button.
            onClick={(event) => {
              const { left, bottom } =
                event.currentTarget.getBoundingClientRect()
              event.currentTarget.dispatchEvent(
                new MouseEvent("contextmenu", {
                  bubbles: true,
                  cancelable: true,
                  clientX: left,
                  clientY: bottom,
                })
              )
            }}
          >
            <EllipsisIcon />
          </Button>
        </span>
      )}
    </div>
  )
}

/** A machine's icon and name, as its group's header names it: this
 * machine's, or another's, as the Window last heard them. */
function MachineName({ host }: { host?: string }) {
  const here = useHereNamed()
  const shown = useShownOf(host)
  const named = host === undefined ? here : shown?.named
  return (
    <>
      {named && <MachineIcon icon={named.icon} size={14} />}
      <span className="min-w-0 truncate font-medium">
        {named?.name ?? host ?? "This machine"}
      </span>
    </>
  )
}
