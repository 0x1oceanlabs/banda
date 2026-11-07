/** An entry as a line of its own (ADR 0091, decision 2). */
import { Entry } from "../entries"
import type { LineProps } from "./types"

export function EntryLine({ line, facts }: LineProps<"item">) {
  return <Entry item={line.item} {...facts.of(line.item)} />
}
