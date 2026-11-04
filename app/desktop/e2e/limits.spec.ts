import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { startWindow, type Window } from "./window"

let window: Window
test.afterEach(async () => window?.close())

test("the limits ring follows the machine, opens its accounts, and hides with reading off", async () => {
  window = await startWindow()
  const { page, dir } = window
  await page.getByLabel("Name").fill("Work")
  await page.getByRole("button", { name: "Create Space" }).click()
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
  const ring = page.getByRole("button", { name: /^Usage limits:/ })
  await expect(ring).toHaveCount(0)
  const cli = join(dir, "codex")
  // No paid model or credentials: only the app-server's limits protocol.
  writeFileSync(
    cli,
    `#!/usr/bin/env node
const lines = require("readline").createInterface({ input: process.stdin })
lines.on("line", line => {
  const { id, method } = JSON.parse(line)
  if (id === undefined) return
  const result = method === "initialize" ? {} : {
    rateLimits: { planType: "pro", primary: { usedPercent: Number(process.env.TEST_LIMIT_USED || 85), windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 3 * 86400 } }
  }
  process.stdout.write(JSON.stringify({ id, result }) + "\\n")
})
`,
    { mode: 0o755 }
  )
  let config = `[[harness]]\nid = "codex"\ncli = { program = ${JSON.stringify(cli)}, variable = "CODEX_PATH" }\n`
  writeFileSync(join(dir, "config/harnesses.toml"), config)
  window.banda("call", "harnesses.limits", "--params", '{"read":true}')
  await expect(ring).toBeVisible()
  await expect(ring).toHaveClass(/text-warning/)
  await expect
    .poll(() =>
      ring.evaluate((el) => {
        const sample = document.createElement("span")
        sample.style.color = "var(--warning)"
        el.append(sample)
        const same =
          getComputedStyle(el).color === getComputedStyle(sample).color
        sample.remove()
        return same
      })
    )
    .toBe(true)
  await expect(ring).toHaveAttribute("title", /Weekly 85% used/)
  await ring.click()
  const popup = page.getByRole("dialog", { name: "Usage limits" })
  await expect(popup.getByText("Pro", { exact: true })).toBeVisible()
  await expect(
    popup.getByRole("meter", { name: "Weekly used" })
  ).toHaveAttribute("aria-valuenow", "85")
  await expect(popup.getByText(/resets in 3d/)).toBeVisible()
  await expect(popup.getByText(/At this pace the week runs out/)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(popup).toBeHidden()
  await expect(ring).toBeFocused()
  config += `\n[[harness]]\nid = "codex-work"\nname = "Work account"\ncommand = "acp"\ncli = { program = ${JSON.stringify(cli)}, variable = "CODEX_PATH" }\nenv = { TEST_LIMIT_USED = "100" }\n`
  writeFileSync(join(dir, "config/harnesses.toml"), config)
  window.banda("call", "harnesses.limits", "--params", '{"read":true}')
  await expect(ring).toHaveClass(/text-destructive/)
  await ring.click()
  await expect(popup.getByRole("meter")).toHaveCount(2)
  await expect(popup.getByText("Work account", { exact: true })).toBeVisible()
  await expect(popup.getByText(/back in 3d/)).toBeVisible()
  await expect(popup).toHaveCSS("opacity", "1")
  await page.screenshot({ path: test.info().outputPath("limits.png") })
  await page.keyboard.press("Escape")
  writeFileSync(
    join(dir, "config/harnesses.toml"),
    "[limits]\nread = false\n" + config
  )
  // Opening asks for a new snapshot too, so reading off hides it without a reload.
  await ring.click()
  await expect(ring).toHaveCount(0)
})
