/** A message: the Person's, or the Agent's reply (ADR 0010, ADR 0058). */
import { AgentMessage, PersonMessage, Writer } from "../Messages"
import { useThreadAround } from "../thread/context"
import type { EntryProps } from "./types"

export function MessageEntry({
  item,
  live,
  writer,
  forks,
  edits,
}: EntryProps<"message">) {
  const { reader, acts } = useThreadAround()
  const body = item.body
  return item.author.kind === "person" ? (
    <PersonMessage
      onEdit={edits && (() => acts.rewind(edits, item))}
      text={body.text}
      images={body.images}
      at={item.at}
      reader={reader}
    />
  ) : (
    <AgentMessage
      text={body.text}
      at={item.at}
      live={live}
      onFork={forks && (() => acts.fork(forks))}
      from={
        writer && (
          <Writer
            thread={writer}
            answers={body.answers}
            onOpen={acts.openThread}
          />
        )
      }
    />
  )
}
