import type { HarnessOption, Settings } from "@banda/contract/agents"
import { describe, expect, it } from "vitest"
import {
  levelAt,
  levelsOf,
  modelName,
  modelNow,
  pickedOf,
  resetOf,
} from "./picker"

const choices = (...values: string[]) =>
  values.map((value) => ({ value, name: value }))

// As Claude Code offers them.
const model: HarnessOption = {
  id: "model",
  name: "Model",
  category: "model",
  value: "opus",
  choices: [
    {
      value: "default",
      name: "Default (recommended)",
      description: "Opus 5.5",
    },
    { value: "opus", name: "Opus 5.5", description: "For complex work" },
  ],
}
const effort: HarnessOption = {
  id: "effort",
  name: "Effort",
  category: "thought_level",
  value: "high",
  choices: [
    { value: "default", name: "Default" },
    ...choices("low", "medium", "high", "xhigh", "max"),
  ],
}
const fast: HarnessOption = {
  id: "fast",
  name: "Fast mode",
  category: "model_config",
  value: false,
  choices: [],
}
const ultracode: HarnessOption = { ...fast, id: "ultracode", name: "Ultracode" }
const agent: HarnessOption = {
  id: "agent",
  name: "Agent",
  value: "default",
  choices: choices("default", "reviewer"),
}

const settings = (options: Settings["options"] = {}): Settings => ({
  mode: "full_access",
  plan: false,
  options,
})

describe("the model picker", () => {
  it("sets the model, the effort and Fast mode, and leaves the rest", () => {
    const picked = pickedOf([model, effort, fast, ultracode, agent])
    expect(picked.model).toBe(model)
    expect(picked.effort).toBe(effort)
    expect(picked.fast).toBe(fast)
    expect(picked.rest).toEqual([ultracode, agent])
  })

  it("slides through the levels, not the Harness's default", () => {
    expect(levelsOf(effort).map((level) => level.value)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ])
    expect(levelAt(settings(), effort)).toEqual({ at: 2, unset: false })
    // On the default, the thumb waits on Medium.
    expect(levelAt(settings({ effort: "default" }), effort)).toEqual({
      at: 1,
      unset: true,
    })
  })

  it("names the default model by the model it is", () => {
    expect(modelName(model.choices[0])).toBe("Opus 5.5")
    expect(modelName(model.choices[1])).toBe("Opus 5.5")
  })

  it("puts the model and effort back on the Harness's defaults", () => {
    const picked = pickedOf([model, effort, fast])
    expect(resetOf(settings({ fast: true }), picked)?.options).toEqual({
      fast: true,
      model: "default",
      effort: "default",
    })
    expect(
      resetOf(settings({ model: "default", effort: "default" }), picked)
    ).toBeUndefined()
    // A Harness with no defaults of its own has nothing to go back to.
    const codex = pickedOf([
      { ...model, choices: choices("gpt", "gpt-mini") },
      { ...effort, choices: choices("low", "medium", "high") },
    ])
    expect(resetOf(settings(), codex)).toBeUndefined()
  })

  it("names the model a Thread runs on, its default by the model it stands for", () => {
    expect(modelNow(settings(), [model])).toBe("Opus 5.5")
    expect(modelNow(settings({ model: "default" }), [model])).toBe("Opus 5.5")
    expect(modelNow(settings({ model: "gone" }), [model])).toBeUndefined()
    expect(modelNow(settings(), [effort])).toBeUndefined()
  })
})
