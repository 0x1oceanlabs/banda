/** A notice: something the Thread says about itself. */
import {
  Trace,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import { InfoIcon } from "lucide-react"
import type { EntryProps } from "./types"

export function NoticeEntry({ item }: EntryProps<"notice">) {
  return (
    <Trace>
      <TraceLine>
        <TraceIcon>
          <InfoIcon />
        </TraceIcon>
        <TraceTitle className="whitespace-normal">{item.body.text}</TraceTitle>
      </TraceLine>
    </Trace>
  )
}
