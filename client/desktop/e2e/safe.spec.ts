import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

test("after two starts that broke, the window opens without the workspaces, which come back (ADR 0039)", async () => {
  window = await startWindow()
  const { page } = window
  const { thread } = await firstThread(page)
  await expect(thread).toBeVisible()

  // The start before this one never went well, nor did the one before it.
  await page.evaluate(() => localStorage.setItem("banda.starts", "2"))
  await page.reload()
  const card = page.getByRole("region", {
    name: "Banda didn't start the last two times",
  })
  await expect(card).toBeVisible()
  await card
    .getByRole("button", { name: "Open without the workspaces" })
    .click()

  // An empty workspace, and the bar says what is aside.
  const pill = page
    .getByRole("status")
    .filter({ hasText: "Workspaces set aside" })
  await expect(pill).toContainText("1 workspace, 1 Pane")
  await expect(thread).toBeHidden()
  const listed = JSON.parse(window.banda("call", "workspaces.list")) as {
    ok: { aside: unknown }
  }
  expect(listed.ok.aside).toEqual({ workspaces: 1, panes: 1 })

  // They come back.
  await pill.getByRole("button", { name: "Bring them back" }).click()
  await expect(pill).toBeHidden()
  await expect(thread).toBeVisible()

  // This start went well: the next one opens as usual.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("banda.starts")), {
      timeout: 10_000,
    })
    .toBeNull()
  await page.reload()
  await expect(thread).toBeVisible()
  await expect(card).toBeHidden()
})
