import { LayersIcon } from "lucide-react"
import { holds } from "../thread/findIn"
import { did } from "../thread/timeline"
import { Kinds } from "../entries/parts/WorkFold"
import { Folded } from "./folded"
import type { LineProps } from "./types"

/**
 * Tool calls and thoughts in a row, as one line that says what they did
 * (ADR 0058, decision 4): "Ran 3 commands (1 failed), edited 2 files +38
 * −9". Opened, it lists them under one rule, each opening on its own.
 */
export function WorkLine({ line, facts }: LineProps<"work">) {
  const turn = facts.turnState(line.turn)
  const done = did(line.items, turn)
  return (
    <Folded
      icon={<LayersIcon />}
      title={
        done.kinds.length > 0 ? (
          <Kinds did={done} capital />
        ) : turn === "running" ? (
          "Working"
        ) : (
          "Worked"
        )
      }
      did={done}
      found={holds(line, facts.finding)}
      lines={line.items.map((item) => ({ kind: "item", item }))}
      facts={facts}
    />
  )
}
