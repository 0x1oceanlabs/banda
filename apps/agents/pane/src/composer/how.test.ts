import { describe, expect, test } from "vitest"
import type { HarnessOption, Settings } from "@banda/contract/agents"
import { howOf, starred } from "./how"
import { pickedOf } from "./picker"

const option = (
  id: string,
  category: string,
  choices: [string, string, string?][],
  more: Partial<HarnessOption> = {}
): HarnessOption =>
  ({
    id,
    name: id,
    category,
    value: choices[0]?.[0] ?? false,
    choices: choices.map(([value, name, description]) => ({
      value,
      name,
      description,
    })),
    ...more,
  }) as HarnessOption

const model = option("model", "model", [
  ["default", "Default", "Opus 5.5"],
  ["opus", "Opus 5.5", "Most capable"],
  ["sonnet", "Sonnet 5.5", "Fast"],
  ["haiku", "Haiku 5.5", "Fastest"],
  ["fable", "Fable 5.2"],
])
const effort = option("effort", "thought_level", [
  ["default", "Default"],
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["ultra", "Ultra"],
])
const fast = option("fast_mode", "model_config", [], {
  name: "Fast mode",
  description: "Faster output",
})
const picked = pickedOf([model, effort, fast])
const settings = (values: Record<string, string | boolean>): Settings =>
  ({ options: values }) as unknown as Settings

describe("howOf", () => {
  test("with no menu named, the menu is the first three, the Thread's model first when not in it", () => {
    const how = howOf(
      picked,
      settings({ model: "haiku", effort: "high", fast_mode: true }),
      [],
      "Claude Code"
    )
    expect(how.model).toBe("Haiku 5.5")
    expect(how.menu.map((one) => one.value)).toEqual([
      "haiku",
      "default",
      "opus",
      "sonnet",
    ])
    expect(how.starred.map((one) => one.value)).toEqual([
      "default",
      "opus",
      "sonnet",
    ])
    expect(how.rest.map((one) => one.value)).toEqual(["haiku", "fable"])
    expect(how.level).toMatchObject({ name: "High", top: false })
    expect(how.levels.map((one) => one.top)).toEqual([
      false,
      false,
      false,
      true,
    ])
    expect(how.fast).toEqual({
      name: "Fast mode",
      about: "Faster output",
      on: true,
    })
    expect(how.reset).toBeDefined()
  })

  test("a named menu holds what the Harness offers of it, in its order", () => {
    const how = howOf(
      picked,
      settings({ model: "opus" }),
      ["fable", "opus", "gone"],
      "Claude Code"
    )
    expect(how.menu.map((one) => one.value)).toEqual(["opus", "fable"])
    expect(how.level).toBeUndefined()
  })

  test("the Harness's default says the model it stands for", () => {
    const how = howOf(picked, settings({ model: "default" }), [], "Claude")
    expect(how.model).toBe("Opus 5.5")
    expect(how.reset).toBeUndefined()
  })

  test("a Harness that has said no models goes by its name", () => {
    const how = howOf(pickedOf([]), settings({}), [], "Codex")
    expect(how).toMatchObject({ name: "Codex", model: undefined, menu: [] })
    expect(how.levels).toEqual([])
  })
})

describe("starred", () => {
  const how = howOf(picked, settings({ model: "opus" }), [], "Claude Code")

  test("starring adds to the first three, in the Harness's order", () => {
    expect(starred(how, "haiku")).toEqual([
      "default",
      "opus",
      "sonnet",
      "haiku",
    ])
  })

  test("unstarring takes one out", () => {
    expect(starred(how, "opus")).toEqual(["default", "sonnet"])
  })

  test("back to the first three names none", () => {
    const more = howOf(
      picked,
      settings({ model: "opus" }),
      ["default", "opus", "sonnet", "haiku"],
      "Claude Code"
    )
    expect(starred(more, "haiku")).toEqual([])
  })
})
