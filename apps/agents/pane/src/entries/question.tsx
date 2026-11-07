/** A Question's place in the Thread; it is answered on the composer
 * (ADR 0058, decision 6). */
import { Question } from "../Questions"
import type { EntryProps } from "./types"

export function QuestionEntry({ item }: EntryProps<"question">) {
  return <Question question={item.body} />
}
