/**
 * A Project's sign (ADR 0070): its picture, an emoji, a Lucide icon or
 * letters, on a quiet tile (look B): a colour only when the Person picked
 * one, never one that an Agent's state says. No Project's is a dashed
 * empty tile. A Project the Person does not trust wears a small grey
 * dashed circle at the tile's corner (ADR 0083, decision 5), wherever its
 * sign shows.
 */
import type { ProjectSummary, Sign, SignColor } from "@banda/contract"
import { CircleDashedIcon } from "lucide-react"
import { DynamicIcon, type IconName } from "lucide-react/dynamic"
import type { CSSProperties } from "react"
import { isNoProject, projectLabel } from "@banda/ui/lib/projects"
import { useSignPicture } from "@banda/ui/lib/signs"
import { cn } from "@banda/ui/lib/utils"

/** The sizes a sign is drawn at: in a row or a header, in a list or the
 * bar, and in the settings. */
export type SignSize = 14 | 16 | 40

export function ProjectSign({
  project,
  size = 16,
  className,
}: {
  /** None, or a scratch one, is No Project. */
  project: ProjectSummary | undefined
  size?: SignSize
  className?: string
}) {
  const side: CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.max(3, Math.round(size * 0.26)),
  }
  if (!project || isNoProject(project))
    return (
      <span
        aria-hidden
        data-sign="none"
        style={side}
        className={cn(
          "inline-block shrink-0 border border-dashed border-muted-foreground/60",
          className
        )}
      />
    )
  const tint = tinted(project.sign)
  const corner = project.trusted ? undefined : cornerOf(size)
  const tile = (
    <span
      aria-hidden
      data-sign={project.sign.kind}
      style={{ ...side, ...tint, ...(corner && { maskImage: corner.cut }) }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden leading-none font-bold",
        project.sign.kind !== "picture" &&
          !tint &&
          "bg-foreground/10 text-muted-foreground",
        !corner && className
      )}
    >
      <Inside project={project} size={size} />
    </span>
  )
  if (!corner) return tile
  // The tile gives up its corner to the circle, so it reads on any
  // surface; the circle stands half out, where the name keeps its room.
  return (
    <span
      aria-hidden
      data-untrusted=""
      title={UNTRUSTED}
      style={{ marginRight: corner.out }}
      className={cn("relative inline-flex shrink-0", className)}
    >
      {tile}
      <CircleDashedIcon
        strokeWidth={2.6}
        className="absolute text-muted-foreground"
        style={{
          width: corner.icon,
          height: corner.icon,
          right: -corner.out,
          bottom: -corner.out,
        }}
      />
    </span>
  )
}

/** What the corner of a sign not trusted says, as its tooltip. */
export const UNTRUSTED = "Not trusted: its own settings wait"

/** The corner's circle for a sign of `size`: how wide it is, how far it
 * stands out of the tile, and the round cut the tile gives up for it. */
function cornerOf(size: SignSize) {
  const icon = Math.round(Math.min(size * 0.64, 16))
  const out = icon / 2
  const hole = out + 1.5
  return {
    icon,
    out,
    cut: `radial-gradient(circle at 100% 100%, transparent ${hole}px, #000 ${hole + 0.5}px)`,
  }
}

/** A Project's sign and name, as a row's line and a Pane's header show
 * them. */
export function ProjectName({
  project,
  className,
}: {
  project: ProjectSummary | undefined
  className?: string
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <ProjectSign project={project} size={14} />
      <span className="min-w-0 truncate">{projectLabel(project)}</span>
    </span>
  )
}

function Inside({
  project,
  size,
}: {
  project: ProjectSummary
  size: SignSize
}) {
  const { sign } = project
  const picture = useSignPicture(
    project.id,
    sign.kind === "picture" ? sign.text : undefined
  )
  switch (sign.kind) {
    case "picture":
      return picture ? (
        <img
          src={picture}
          alt=""
          draggable={false}
          className="size-full object-contain"
        />
      ) : null
    case "icon":
      return (
        <DynamicIcon
          name={sign.text as IconName}
          size={Math.round(size * 0.66)}
          strokeWidth={size > 24 ? 1.8 : 2.4}
        />
      )
    case "emoji":
    case "letters": {
      const scale =
        sign.kind === "emoji" ? 0.68 : sign.text.length > 1 ? 0.5 : 0.62
      return (
        <span style={{ fontSize: Math.round(size * scale) }}>{sign.text}</span>
      )
    }
  }
}

/** The quiet palette a sign's letters or icon take (ADR 0070, decision 4),
 * by name; the look's `--sign-*` say each one's colour. */
export const SIGN_COLORS = {
  violet: "Violet",
  magenta: "Magenta",
  yellow: "Yellow",
  teal: "Teal",
  sand: "Sand",
} satisfies Record<SignColor, string>

/** A palette colour, as the look says it. */
export function signColor(color: SignColor): string {
  return `var(--sign-${color})`
}

/** A picked colour's text and its thinned tile, for letters and an icon;
 * none keeps the quiet tile. A picture and an emoji keep their own. */
function tinted(sign: Sign): CSSProperties | undefined {
  if (!sign.color || (sign.kind !== "icon" && sign.kind !== "letters"))
    return undefined
  const colour = signColor(sign.color)
  return {
    color: colour,
    backgroundColor: `color-mix(in oklab, ${colour} 16%, transparent)`,
  }
}
