import { CircleCheckIcon, CircleSlashIcon } from "lucide-react"
import { holds } from "../thread/findIn"
import { did, foldTitle, workOf } from "../thread/timeline"
import { Kinds } from "../entries/parts/WorkFold"
import { Folded } from "./folded"
import type { LineProps } from "./types"

/** What a turn that ended did before its last reply, folded into one
 * line: how long it took, what it did and how much it changed. */
export function FoldLine({ line, facts }: LineProps<"fold">) {
  const { turn, lines } = line
  const Icon = turn.state === "stopped" ? CircleSlashIcon : CircleCheckIcon
  const done = did(workOf(lines), turn.state)
  return (
    <Folded
      icon={<Icon />}
      title={
        <>
          {foldTitle(turn)}
          {done.kinds.length > 0 && (
            <>
              {" · "}
              <Kinds did={done} />
            </>
          )}
        </>
      }
      did={done}
      found={holds(line, facts.finding)}
      lines={lines}
      facts={facts}
    />
  )
}
