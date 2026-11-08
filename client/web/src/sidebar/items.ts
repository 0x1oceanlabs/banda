/**
 * What the Person can do to one Item, by its item actions (ADR 0087,
 * decision 12): its App's, found by the first word of its Pane kind, in
 * their order. The Thread menu, the Pane menu, the Banda menu's Tab, the
 * title's field and the sidebar's row draw their rows, and run them as any
 * action, by id: none of them knows what an App does to its Items.
 */
import type { ItemAction } from "@banda/ui/module"
import type { Listed } from "@banda/ui/pane"
import { itemsOf } from "../registry"
import type { Shell } from "../window/actions"

/** The item actions of `listed`, its App's, in their order. */
export function itemActionsOf(listed: Listed): readonly ItemAction<Shell>[] {
  return itemsOf(listed.pane.kind)
}

/** The item action of `listed` that does `does`, as the title's field
 * renames by its App's; none where its App has none. */
export function itemActionOf(
  listed: Listed,
  does: NonNullable<ItemAction["does"]>
): ItemAction<Shell> | undefined {
  return itemActionsOf(listed).find((action) => action.does === does)
}
