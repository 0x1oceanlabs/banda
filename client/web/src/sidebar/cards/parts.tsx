/**
 * The parts a card's lines are made of (ADR 0098, decision 8), drawn
 * once for every kind of card: the mark's cell, the title, line 2's
 * words, the diff and a pull request's chip, the Project's sign, a
 * child's ↳ and the diamond of a Thread away from its Project's
 * workspace. Each draws what it is given, and reads nothing else. Text
 * that does not fit fades out at its end, and shows whole as the pointer
 * rests on it (`FadeText`'s tooltip, where a `CutTips` holds it).
 */
import type { ProjectSummary } from "@banda/contract"
import { FadeText } from "@banda/ui/components/fade-text"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { projectLabel } from "@banda/ui/lib/projects"
import { cn } from "@banda/ui/lib/utils"
import { DiamondIcon } from "lucide-react"
import type { ReactNode } from "react"
import {
  PULL_GLYPHS,
  type PullChip as Pull,
  type PullState,
  pullWords,
  type Quiet,
  STRAYED,
} from "./model"

/** Line 1's mark, in a cell of its own. */
export function MarkCell({ children }: { children: ReactNode }) {
  return (
    <span className="flex shrink-0 items-center justify-center">
      {children}
    </span>
  )
}

/** A card's title: at 500 where it calls for the Person, grey at work
 * and dimmer put away; while a model writes one, it shimmers (ADR 0077,
 * decision 3). */
export function CardTitle({
  title,
  tip,
  strong = false,
  quiet,
  shimmer = false,
}: {
  title: string
  /** What its tooltip says whole; none, it has none. */
  tip?: string
  strong?: boolean
  quiet?: Quiet
  shimmer?: boolean
}) {
  return (
    <FadeText
      tip={tip}
      className={cn(
        "text-ui",
        strong && "font-medium",
        quiet === "working"
          ? "text-foreground/45"
          : quiet
            ? "text-foreground/55"
            : "text-foreground"
      )}
    >
      <span data-shimmer={shimmer || undefined}>{title}</span>
    </FadeText>
  )
}

/** Line 2's words: a word, **Asks**, **Done**, **Project**…, then what it
 * says, never in a colour; the word dimmer on a quiet card. */
export function Says({
  word,
  text,
  tip = [word, text].filter(Boolean).join(" "),
  quiet = false,
}: {
  word?: string
  text?: string
  /** What its tooltip says whole: the word and the words, by default. */
  tip?: string
  quiet?: boolean
}) {
  return (
    <FadeText tip={tip} className="flex-1 text-meta text-muted-foreground">
      {word && (
        <span
          className={cn(
            "font-medium",
            quiet ? "text-foreground/55" : "text-foreground/85"
          )}
        >
          {word}
        </span>
      )}
      {word && text && " "}
      {text}
    </FadeText>
  )
}

/** Line 2 at work: what its Agent does, muted a step more than a call's
 * words, as its time (§2.5). */
export function Works({ words }: { words: string }) {
  return (
    <FadeText
      tip={words || undefined}
      className="flex-1 text-meta text-muted-foreground/60"
    >
      {words}
    </FadeText>
  )
}

/** The lines its last work added and removed, in grey, as Git says it,
 * with a true minus (decision 8). */
export function Diff({ added, removed }: { added: number; removed: number }) {
  return (
    <span
      data-diff=""
      className="shrink-0 text-meta text-muted-foreground/60 tabular-nums"
    >
      +{added} −{removed}
    </span>
  )
}

/** The colour of a pull request's glyph, as its need's on the bar (ADR
 * 0076, decision 3); one that landed keeps the text's. */
const GLYPH_COLOUR: Readonly<Partial<Record<PullState, string>>> = {
  passed: "text-added",
  failed: "text-destructive",
  running: "text-mark-working",
}

/** A Thread's pull requests, in the diff's grey, its glyph alone in a
 * colour (F2): "#1061 ✓", "3 PRs ✗". */
export function PullChip({ pull }: { pull: Pull }) {
  return (
    <span
      data-pull={pull.state ?? ""}
      className="shrink-0 text-meta text-muted-foreground/60 tabular-nums"
    >
      {pullWords(pull)}
      {pull.state && (
        <>
          {" "}
          <span className={GLYPH_COLOUR[pull.state]}>
            {PULL_GLYPHS[pull.state]}
          </span>
        </>
      )}
    </span>
  )
}

/** A Project's sign and name, small and muted, on line 3. */
export function ProjectName({ project }: { project: ProjectSummary }) {
  const name = projectLabel(project)
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-meta text-muted-foreground">
      <ProjectSign project={project} size={14} />
      <FadeText tip={name}>{name}</FadeText>
    </span>
  )
}

/** In the Project's place, a child's parent: ↳ and its title (decision
 * 24). */
export function Parent({ title }: { title: string }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-meta text-muted-foreground">
      <ChildArrow className="w-3.5" />
      <FadeText tip={title}>{title}</FadeText>
    </span>
  )
}

/** Small muted words at a line's right, in figures of one width: since
 * when its machine is out of reach, "· away 12m". */
export function Meta({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 text-meta text-muted-foreground tabular-nums">
      {children}
    </span>
  )
}

/** A child's ↳, muted, in a column of its own (decision 24); a screen
 * reader hears who started it in the card's description. */
export function ChildArrow({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0 text-center text-meta text-muted-foreground",
        className
      )}
    >
      ↳
    </span>
  )
}

/** The mark of a Thread away from its Project's workspace (ADR 0102,
 * decision 6): a small diamond, as an arrow is the sign of a Pane in its
 * own window, where the card's acts never cover it. A screen reader
 * hears it in the card's description. */
export function Strayed() {
  return (
    <span title={STRAYED} className="shrink-0 text-muted-foreground">
      <DiamondIcon aria-hidden className="size-3" />
    </span>
  )
}
