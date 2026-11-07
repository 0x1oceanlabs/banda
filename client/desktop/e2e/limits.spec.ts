import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window
test.afterEach(async () => window?.close())

test("the limits widget follows the machine, lists its accounts, changes its look, and hides with reading off", async () => {
  window = await startWindow()
  const { page, dir } = window
  await firstThread(page)
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
  const widget = page.getByRole("button", { name: /^Usage limits:/ })
  await expect(widget).toHaveCount(0)
  const cli = join(dir, "codex")
  // No paid model or credentials: only the app-server's limits and
  // account protocol. Each account has its own email, so none is merged.
  writeFileSync(
    cli,
    `#!/usr/bin/env node
const lines = require("readline").createInterface({ input: process.stdin })
lines.on("line", line => {
  const { id, method } = JSON.parse(line)
  if (id === undefined) return
  const result = method === "initialize" ? {} : method === "account/read" ? {
    account: { type: "chatgpt", email: process.env.TEST_EMAIL || "p@example.com", planType: "pro" }
  } : {
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
  await expect(widget).toBeVisible()
  const gauge = widget.locator("svg")
  await expect(gauge).toHaveClass(/text-warning/)
  await expect
    .poll(() =>
      gauge.evaluate((el) => {
        const sample = document.createElement("span")
        sample.style.color = "var(--warning)"
        document.body.append(sample)
        const same =
          getComputedStyle(el).color === getComputedStyle(sample).color
        sample.remove()
        return same
      })
    )
    .toBe(true)
  await expect(widget).toHaveAttribute("title", "Codex: Weekly 85%")
  await widget.click()
  const popup = page.getByRole("dialog", { name: "Usage limits" })
  await expect(popup.getByText("Pro", { exact: true })).toBeVisible()
  await expect(
    popup.getByRole("meter", { name: "Weekly used" })
  ).toHaveAttribute("aria-valuenow", "85")
  await expect(popup.getByText(/^At this pace, out .* early$/)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(popup).toBeHidden()
  await expect(widget).toBeFocused()
  config += `\n[[harness]]\nid = "codex-work"\nname = "Work account"\ncommand = "acp"\ncli = { program = ${JSON.stringify(cli)}, variable = "CODEX_PATH" }\nenv = { TEST_LIMIT_USED = "100", TEST_EMAIL = "w@example.com" }\n`
  writeFileSync(join(dir, "config/harnesses.toml"), config)
  window.banda("call", "harnesses.limits", "--params", '{"read":true}')
  // One account out while the other has room: the widget shows the room
  // and marks the one out.
  await expect(widget).toHaveAttribute(
    "title",
    /^Codex: Weekly 85% · Work account out, back in 3d/
  )
  await expect(gauge).toHaveClass(/text-warning/)
  await widget.click()
  await expect(popup.getByRole("meter")).toHaveCount(2)
  await expect(popup.getByText("Work account", { exact: true })).toBeVisible()
  await expect(popup.getByText(/^back in 3d/)).toBeVisible()
  await expect(popup.getByText("most room", { exact: true })).toBeVisible()
  await expect(popup).toHaveCSS("opacity", "1")
  await page.screenshot({ path: test.info().outputPath("limits.png") })
  await page.keyboard.press("Escape")
  // Its context menu picks the look, and writes it to the file.
  await widget.click({ button: "right" })
  await page.getByRole("menuitemradio", { name: "Share", exact: true }).click()
  await expect(widget).toHaveText("85%")
  expect(readFileSync(join(dir, "config/harnesses.toml"), "utf8")).toMatch(
    /look = "number"/
  )
  config = readFileSync(join(dir, "config/harnesses.toml"), "utf8")
  writeFileSync(
    join(dir, "config/harnesses.toml"),
    config.replace("[limits]\n", "[limits]\nread = false\n")
  )
  // Opening asks for a new snapshot too, so reading off hides it without a reload.
  await widget.click()
  await expect(widget).toHaveCount(0)
})
