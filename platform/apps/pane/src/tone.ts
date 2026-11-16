/** A Tree's tones as Banda UI's colours. */
import type { TreeTone } from "@banda/contract/apps"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  type LucideIcon,
  TriangleAlertIcon,
} from "lucide-react"

/** An Alert's kind and sign by its tone. */
export const ALERT: Record<
  TreeTone,
  { variant: "default" | "good" | "warning" | "destructive"; Icon: LucideIcon }
> = {
  plain: { variant: "default", Icon: InfoIcon },
  good: { variant: "good", Icon: CircleCheckIcon },
  warn: { variant: "warning", Icon: TriangleAlertIcon },
  bad: { variant: "destructive", Icon: CircleAlertIcon },
}

/** The text colour that says a tone; none for a plain one. */
export function toneText(tone: TreeTone | undefined): string | undefined {
  switch (tone) {
    case "good":
      return "text-added"
    case "warn":
      return "text-warning"
    case "bad":
      return "text-destructive"
    default:
      return undefined
  }
}

/** A badge's edge and text in its tone. */
export function toneBadge(tone: TreeTone | undefined): string | undefined {
  switch (tone) {
    case "good":
      return "border-added/40 text-added"
    case "warn":
      return "border-warning/40 text-warning"
    case "bad":
      return "border-destructive/40 text-destructive"
    default:
      return undefined
  }
}
