/**
 * What a card offers under the pointer (ADR 0098, decision 10), by where
 * its Thread stands: Later first, then Archive; Wake in Later; Unarchive
 * in the Archive. Pure, so plain tests cover it.
 */
import type { Listed } from "@banda/ui/pane"
import { mayArchive, type Stand } from "@banda/ui/status"

/** An act a card offers, by its id. */
export type Act = "later" | "archive" | "wake" | "unarchive"

const LATER: readonly Act[] = ["later"]
const LATER_ARCHIVE: readonly Act[] = ["later", "archive"]
const WAKE: readonly Act[] = ["wake"]
const UNARCHIVE: readonly Act[] = ["unarchive"]

/**
 * The acts of a card whose Thread, `listed`, stands at `stand`, in their
 * order:
 * - one that asks: Later, as it is never archived while it asks (decision
 *   11), a Woke one asking again too;
 * - Done, Failed, Woke and Open: Later, Archive;
 * - at work: Later, whose picker offers "When it's done" first;
 * - put off: Wake; archived: Unarchive.
 */
export function actsOf(
  stand: Stand,
  listed: Pick<Listed, "mark">
): readonly Act[] {
  switch (stand) {
    case "later":
      return WAKE
    case "archived":
      return UNARCHIVE
    case "working":
      return LATER
    default:
      return mayArchive(listed) ? LATER_ARCHIVE : LATER
  }
}

/** How wide the acts of a card stand at line 1's right, in px: 20 px
 * each, 2 px apart (spec §2.5). */
export function actsWidth(count: number): number {
  return count > 0 ? count * 22 - 2 : 0
}
