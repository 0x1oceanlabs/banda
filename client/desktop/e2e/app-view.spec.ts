import { resolve } from "node:path"
import { expect, test } from "@playwright/test"
import {
  bandaMenu,
  call,
  firstThread,
  projectId,
  startWindow,
  type Window,
} from "./window"

/** The clients App of the apps module's tests: its `home` is a screen. */
const CLIENTS = resolve(
  import.meta.dirname,
  "../../../platform/apps/engine/tests/folders/clients"
)

let window: Window
test.afterEach(async () => window?.close())

test("an App an Agent wrote has a screen: the window draws its Tree, its form adds a row, and it follows what an Agent adds", async () => {
  window = await startWindow()
  const { page } = window
  await firstThread(page)

  // Installed while the window runs, as an Agent's shell does it.
  window.banda("app", "install", CLIENTS)
  call(window, "clients.add", { name: "Anna Weber", city: "Berlin" })

  // Opened by a program, as an Agent's `open_pane` does.
  const work = projectId(window, "Work")
  const shows = { app: "clients", view: "home" }
  window.banda(
    "call",
    "workspaces.open",
    "--params",
    JSON.stringify({ project: work, kind: "apps.view", args: shows })
  )
  const pane = page.getByRole("region", { name: "Clients" })
  await expect(pane.getByText("The people I work with:")).toBeVisible()
  const rows = pane.getByRole("row")
  // Its header and Anna.
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(1)).toContainText("Anna Weber")
  await expect(rows.nth(1)).toContainText("Berlin")

  // The form's fields are the params of the command it sends. What the
  // command requires is checked here, before anything is sent.
  const add = pane.getByRole("button", { name: "Add client" })
  await add.click()
  await expect(pane.getByText("Name is required.")).toBeVisible()
  await expect(rows).toHaveCount(2)
  const name = pane.getByRole("textbox", { name: "Name" })
  await name.fill("Emil Sørensen")
  await pane.getByRole("textbox", { name: "City" }).fill("Copenhagen")
  await page.keyboard.press("Enter")
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(2)).toContainText("Emil Sørensen")
  // Sent as the Person, it is the App's own: any Agent finds it.
  expect(call(window, "clients.find", { city: "Copenhagen" })).toHaveLength(1)
  // The form is empty again, for the next one.
  await expect(name).toHaveValue("")
  await expect(name).toBeFocused()

  // What an Agent adds meanwhile shows without a click: the screen is
  // read again on the App's events.
  call(window, "clients.add", { name: "Boris Lima", city: "Lisbon" })
  await expect(rows).toHaveCount(4)
  await expect(rows.nth(2)).toContainText("Boris Lima")

  // The Person finds it in the Banda menu by the App's name.
  await pane.getByRole("button", { name: "Close Clients", exact: true }).click()
  await expect(pane).toBeHidden()
  const menu = await bandaMenu(page)
  await menu.getByRole("combobox", { name: "Search" }).fill("clients")
  await menu.getByRole("option", { name: /^Clients/ }).click()
  await expect(rows).toHaveCount(4)
})
