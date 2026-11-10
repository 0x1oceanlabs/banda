/**
 * The Diff's stage, unstage and revert (ADR 0034, decision 2), as the
 * Codex app's: icons in a file's header and the Pane's, named on a hunk's
 * plate; Revert asks first, in a popover.
 */
import type { ReactNode } from "react"
import { Button } from "@banda/ui/components/button"
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { MinusIcon, PlusIcon, Undo2Icon } from "lucide-react"
import { NAMES, type Act } from "./stage"

const ICONS: Record<Act, typeof PlusIcon> = {
  stage: PlusIcon,
  unstage: MinusIcon,
  revert: Undo2Icon,
}

/** What can be done to a file or a hunk: icons in a file's header, or
 * named on a hunk's plate. Revert asks first. */
export function Acts({
  acts,
  disabled,
  words,
  what,
  asked = what,
  about,
  onAct,
}: {
  acts: Act[]
  disabled: boolean
  /** Each is named beside its icon, or only in a wide Diff; its label
   * names it always. */
  words?: "shown" | "wide"
  /** What it is done to, as its label names it. */
  what: string
  /** What it is done to, as Revert's question names it. */
  asked?: string
  /** What reverting it does. */
  about: string
  onAct: (what: Act) => void
}) {
  return (
    <span className="flex items-center gap-0.5">
      {acts.map((each) => {
        const label = `${NAMES[each]} ${what}`
        const look = {
          variant: "ghost" as const,
          size: words ? ("xs" as const) : ("icon-xs" as const),
          "aria-label": label,
          title: label,
          disabled,
        }
        const Icon = ICONS[each]
        const name =
          words === "wide" ? <Wide>{label}</Wide> : words && NAMES[each]
        const face = (
          <>
            <Icon {...(words ? { "data-icon": "inline-start" } : {})} />
            {name}
          </>
        )
        return each === "revert" ? (
          <Revert
            key={each}
            title={`Revert ${asked}?`}
            about={`${about} This can't be undone.`}
            look={look}
            onRevert={() => onAct(each)}
          >
            {face}
          </Revert>
        ) : (
          <Button key={each} {...look} onClick={() => onAct(each)}>
            {face}
          </Button>
        )
      })}
    </span>
  )
}

/** Words a button shows only in a wide Diff; its label keeps them. */
function Wide({ children }: { children: ReactNode }) {
  return <span className="hidden @2xl/diff:inline">{children}</span>
}

/** A Revert button that asks first, as it cannot be undone. */
function Revert({
  title,
  about,
  look,
  onRevert,
  children,
}: {
  title: string
  about: string
  /** The trigger's look, label and whether it is off. */
  look: Parameters<typeof Button>[0]
  onRevert: () => void
  children: ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="text-destructive hover:text-destructive"
            {...look}
          />
        }
      >
        {children}
      </PopoverTrigger>
      <PopoverContent>
        <PopoverTitle className="break-all">{title}</PopoverTitle>
        <PopoverDescription>{about}</PopoverDescription>
        <div className="mt-2 flex justify-end gap-1.5">
          <PopoverClose render={<Button variant="ghost" size="sm" />}>
            Cancel
          </PopoverClose>
          <PopoverClose
            render={<Button variant="destructive" size="sm" />}
            onClick={onRevert}
          >
            Revert
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  )
}
