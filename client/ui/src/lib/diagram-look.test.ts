import { expect, test } from "vitest"
import { diagramConfig, mix } from "./diagram-look"

test("ink mixes over the ground as color-mix does", () => {
  expect(mix([0, 0, 0], [255, 255, 255], 0)).toBe("#000000")
  expect(mix([0, 0, 0], [255, 255, 255], 1)).toBe("#ffffff")
  expect(mix([255, 255, 255], [0, 0, 0], 0.5)).toBe("#808080")
})

test("a diagram is drawn in the look's ink on its ground", () => {
  const config = diagramConfig([20, 20, 20], [240, 240, 240], "Inter", true)
  expect(config.theme).toBe("base")
  expect(config.themeVariables.darkMode).toBe(true)
  expect(config.themeVariables.textColor).toBe("#f0f0f0")
  expect(config.themeVariables.primaryTextColor).toBe("#f0f0f0")
  // Nodes sit a little above the card, which sits a little above the ground.
  expect(config.themeVariables.background).toBe(
    mix([20, 20, 20], [240, 240, 240], 0.035)
  )
  expect(config.themeVariables.primaryColor).not.toBe(
    config.themeVariables.background
  )
  expect(config.themeVariables.edgeLabelBackground).toBe(
    config.themeVariables.background
  )
})
