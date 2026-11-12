/**
 * What the model picker beside the send button sets, read from what the
 * Harness offers, as Codex shows it: the model, a slider of effort
 * levels, and Fast mode. The Harness's other options go in the mode menu.
 */
import type {
  HarnessOption,
  OptionChoice,
  Settings,
} from "@banda/contract/agents"
import { choose, chosen } from "../thread/state"

/** A Harness's own choice for its default, as Claude Code offers it. */
const DEFAULT = "default"

export type Picked = {
  model?: HarnessOption
  effort?: HarnessOption
  fast?: HarnessOption
  /** The Harness's other options. */
  rest: HarnessOption[]
}

/** `options` split into what the picker sets and the rest. */
export function pickedOf(options: HarnessOption[]): Picked {
  const model = options.find(
    (o) => o.category === "model" && o.choices.length > 0
  )
  const effort = options.find(
    (o) => o.category === "thought_level" && levelsOf(o).length > 1
  )
  const fast = options.find(
    (o) =>
      o.category === "model_config" &&
      o.choices.length === 0 &&
      /fast/i.test(o.id)
  )
  const picked = [model, effort, fast]
  return {
    model,
    effort,
    fast,
    rest: options.filter((o) => !picked.includes(o)),
  }
}

/** The levels an effort slides through: its choices but the Harness's
 * default, which is no level of its own. */
export function levelsOf(effort: HarnessOption): OptionChoice[] {
  return effort.choices.filter((choice) => choice.value !== DEFAULT)
}

/** A model's name; the Harness's default by the model it stands for,
 * which Claude Code says under it. */
export function modelName(choice: OptionChoice): string {
  return choice.value === DEFAULT && choice.description
    ? choice.description
    : choice.name
}

/** The name of the model a Thread runs on, as its picker says it; none
 * while its Harness has said no models. A sub-agent's row shows its own
 * model only when it differs (ADR 0103, decision 15). */
export function modelNow(
  settings: Settings,
  options: HarnessOption[]
): string | undefined {
  const { model } = pickedOf(options)
  if (!model) return undefined
  const value = chosen(settings, model)
  const now = model.choices.find((choice) => choice.value === value)
  return now && modelName(now)
}

/** Where on the slider the effort chosen is, and whether it is the
 * Harness's default, which sits in the middle until a level is chosen. */
export function levelAt(
  settings: Settings,
  effort: HarnessOption | undefined
): { at: number; unset: boolean } {
  if (!effort) return { at: 0, unset: true }
  const levels = levelsOf(effort)
  const at = levels.findIndex((l) => l.value === chosen(settings, effort))
  if (at >= 0) return { at, unset: false }
  const middle = levels.findIndex((l) => l.value === "medium")
  return {
    at: middle >= 0 ? middle : Math.floor(levels.length / 2),
    unset: true,
  }
}

/** `settings` with the model and effort back on the Harness's own
 * defaults, its `default` choices, where it has them; none if they are on
 * them already. Not the settings page's "New Threads", which may say
 * otherwise in `agents.toml`: this is what the Harness would choose. */
export function resetOf(
  settings: Settings,
  { model, effort }: Picked
): Settings | undefined {
  let next = settings
  for (const option of [model, effort]) {
    if (
      option?.choices.some((choice) => choice.value === DEFAULT) &&
      chosen(settings, option) !== DEFAULT
    )
      next = choose(next, option.id, DEFAULT)
  }
  return next === settings ? undefined : next
}

/** Claude's switch that starts a Crew for every big task. */
const ULTRACODE = "ultracode"
/** Codex's top effort level, which hands work to sub-agents. */
const ULTRA = "ultra"

/**
 * The effort word the picker's label shows after the model, and whether
 * it is the top level, drawn in its magenta (ADR 0103, decision 31):
 * "Ultracode" while Claude's switch of that name is on, whatever the
 * level; Codex's "Ultra", its last level; else the level chosen. The
 * switch stays in the mode menu (call 12): this only names it.
 */
export function effortShown(
  settings: Settings,
  options: HarnessOption[],
  level: OptionChoice | undefined
): { name: string; top: boolean } | undefined {
  const ultracode = options.find(
    (o) => o.id === ULTRACODE && o.choices.length === 0
  )
  if (ultracode && chosen(settings, ultracode) === true)
    return { name: ultracode.name, top: true }
  return level && { name: level.name, top: level.value === ULTRA }
}
