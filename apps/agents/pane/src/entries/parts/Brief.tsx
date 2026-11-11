/** What a sub-agent's parent wrote to it, in the sub-agent's own Pane (ADR
 * 0103, decisions 21 and 25): its brief, and each message after it. */
import { Bubble, BubbleContent } from "@banda/ui/components/bubble"
import { Emblem, type EmblemOf } from "@banda/ui/components/emblem"
import { Message, MessageContent } from "@banda/ui/components/message"
import { Satellite } from "@banda/ui/components/satellite"
import type { SatelliteState } from "@banda/ui/lib/satellite"
import { cn } from "@banda/ui/lib/utils"
import { THREAD_ZOOM, useClamp } from "./Messages"

/** Who wrote it, over its bubble: "Claude asked" by its Harness's logo,
 * or, nested, "Reviewer wrote" by its parent's satellite (`look`). */
export type Asker = { words: string; look?: SatelliteState; harness: EmblemOf }

/** Who wrote it over the bubble its parent wrote, on the right as the
 * Person's own; long, clamped until it is opened. The brief is `brief`;
 * a message after it is `wrote`. */
export function Brief({
  asker,
  text,
  slot = "brief",
}: {
  asker: Asker
  text: string
  slot?: "brief" | "wrote"
}) {
  const clamp = useClamp(
    text,
    "max-h-44",
    slot === "brief" ? "Show the whole brief" : "Show the whole message"
  )
  return (
    <Message align="end" data-slot={`subagent-${slot}`}>
      <MessageContent className="items-end">
        <span className="flex items-center gap-1.5 pr-1 text-meta text-muted-foreground">
          {asker.look ? (
            <Satellite state={asker.look} size={10} />
          ) : (
            <Emblem of={asker.harness} className="size-3" />
          )}
          {asker.words}
        </span>
        <Bubble variant="muted" align="end" className={THREAD_ZOOM}>
          <BubbleContent className={cn("whitespace-pre-wrap", clamp.className)}>
            {text}
          </BubbleContent>
        </Bubble>
        {clamp.toggle}
      </MessageContent>
    </Message>
  )
}
