/**
 * What a Thread's "how" picker shows, from what the engine said (ADR 0114,
 * decisions 5 to 8): the model it runs on and its effort, the menu of
 * models, the window of all of them, the effort's levels and Fast mode.
 * Pure, so plain tests cover it; the picker only draws it and says the
 * one change chosen: `Settings` to configure, or the menu to write.
 */
import type { HarnessOption, Settings } from "@banda/contract/agents"
import { choose, chosen } from "../thread/state"
import {
  effortShown,
  levelAt,
  levelsOf,
  modelName,
  resetOf,
  type Picked,
} from "./picker"

/** How many models a menu holds when none are starred (decision 6). */
const FIRST = 3

/** One model, in the menu or the window. */
export type HowModel = {
  value: string
  name: string
  about?: string
  /** The Thread runs on it. */
  on: boolean
  /** It is in the menu. */
  starred: boolean
}

/** One of the effort's levels. */
export type HowLevel = {
  value: string
  name: string
  on: boolean
  /** The top level, Codex's Ultra, drawn in `effort-top` (ADR 0103,
   * decision 31). */
  top: boolean
}

export type How = {
  /** The Harness's name, which the trigger says while it has said no
   * models. */
  name: string
  /** The model it runs on, by its name; none while it has said none. */
  model?: string
  /** The effort chosen, none while it is the Harness's own. */
  /** The effort the trigger names: the level chosen, or Ultracode when
   * the mode menu turned it on; none while it is the Harness's own. */
  level?: { name: string; top: boolean }
  /** Fast mode, when the Harness has it. */
  fast?: { name: string; about?: string; on: boolean }
  /** The menu: the Thread's model first when it is not starred, then the
   * starred, in the Harness's order. */
  menu: HowModel[]
  /** Every model, in the Harness's order. */
  all: HowModel[]
  /** The window: the starred, then the rest. */
  starred: HowModel[]
  rest: HowModel[]
  levels: HowLevel[]
  /** The settings back on the Harness's defaults, when they differ. */
  reset?: Settings
}

/** The picker of a Thread on Harness `name`, with `settings`, from what
 * its Harness offers, `picked`, and the menu its machine names, `menu`:
 * none named is the first three it offers. */
export function howOf(
  picked: Picked,
  settings: Settings,
  menu: readonly string[],
  name: string
): How {
  const { model, effort, fast } = picked
  const value = model && String(chosen(settings, model))
  const stars = starsOf(model, menu)
  const models = (model?.choices ?? []).map((choice): HowModel => ({
    value: choice.value,
    name: modelName(choice),
    about: choice.value === "default" ? undefined : choice.description,
    on: choice.value === value,
    starred: stars.includes(choice.value),
  }))
  const starred = models.filter((one) => one.starred)
  const rest = models.filter((one) => !one.starred)
  const now = models.find((one) => one.on)
  const levels = effort ? levelsOf(effort) : []
  const { at, unset } = levelAt(settings, effort)
  const shown = levels.map((level, i): HowLevel => ({
    value: level.value,
    name: level.name,
    on: !unset && i === at,
    top: effortShown(settings, [], level)?.top ?? false,
  }))
  return {
    name,
    model: now?.name,
    level: effortShown(settings, picked.rest, unset ? undefined : levels[at]),
    fast: fast && {
      name: fast.name,
      about: fast.description,
      on: chosen(settings, fast) === true,
    },
    menu: now && !now.starred ? [now, ...starred] : starred,
    all: models,
    starred,
    rest,
    levels: shown,
    reset: resetOf(settings, picked),
  }
}

/** The models in the menu: those `menu` names that the Harness offers,
 * or its first three. */
function starsOf(
  model: HarnessOption | undefined,
  menu: readonly string[]
): string[] {
  const offered = (model?.choices ?? []).map((choice) => choice.value)
  const named = offered.filter((one) => menu.includes(one))
  return named.length > 0 ? named : offered.slice(0, FIRST)
}

/** The menu to write once `value` is starred or unstarred, in the
 * Harness's order: none when that is its first three, which need no
 * naming. */
export function starred(how: How, value: string): string[] {
  const next = how.all
    .filter((one) => (one.value === value ? !one.starred : one.starred))
    .map((one) => one.value)
  const first = how.all.slice(0, FIRST).map((one) => one.value)
  return next.length === first.length &&
    next.every((one, i) => one === first[i])
    ? []
    : next
}

/** `settings` with `option` set to `value`; none when it is set so
 * already, as each change is a round trip to the Harness. */
export function changed(
  settings: Settings,
  option: HarnessOption | undefined,
  value: string | boolean
): Settings | undefined {
  if (!option || chosen(settings, option) === value) return undefined
  return choose(settings, option.id, value)
}
