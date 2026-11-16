import { join, resolve } from "node:path"
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

/** The deals App beside it: a screen of every node a Tree has. */
const DEALS = resolve(CLIENTS, "../deals")

/** Where the pictures go, when asked for. */
const SHOTS = process.env.BANDA_E2E_SHOTS

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

test("an App's screen of every node: numbers, tabs, a table found and ordered, a row's actions with a form and a question, a chart, a form in a dialog", async () => {
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  const shot = async (name: string) => {
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) })
  }

  window.banda("app", "install", DEALS)
  const deal = (
    client: string,
    amount: number,
    stage: string,
    due: string,
    chance: number
  ) => call(window, "deals.add", { client, amount, stage, due, chance })
  deal("Anna Weber", 12000, "talks", "2031-03-01", 70)
  deal("Boris Lima", 4000, "new", "2020-01-15", 30)
  deal("Chen Studio", 30000, "won", "2026-10-01", 100)
  deal("Dana & Co", 8000, "lost", "2026-09-01", 0)

  const work = projectId(window, "Work")
  window.banda(
    "call",
    "workspaces.open",
    "--params",
    JSON.stringify({
      project: work,
      kind: "apps.view",
      args: { app: "deals", view: "home" },
    })
  )
  const pane = page.getByRole("region", { name: "Deals" })
  // What is past due is said first, and the numbers stand large.
  await expect(pane.getByRole("alert")).toContainText("1 open deal is past due")
  await expect(pane.getByText("16,000", { exact: true })).toBeVisible()
  await expect(pane.getByText("30,000", { exact: true })).toBeVisible()

  // The first tab shows the open deals, the largest first as the App
  // wrote them; a click on a title orders them by it.
  const rows = pane.getByRole("tabpanel").getByRole("row")
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(1)).toContainText("Anna Weber")
  await pane.getByRole("button", { name: "Amount" }).click()
  await expect(rows.nth(1)).toContainText("Boris Lima")
  await shot("app-deals-open")

  // The words typed find rows.
  const find = pane.getByRole("searchbox", { name: "Find rows" })
  await find.fill("anna")
  await expect(rows).toHaveCount(2)
  await find.fill("")

  // A row's action with a form: its fields start from the row, and it
  // sends the row's id with what was filled.
  await rows
    .filter({ hasText: "Boris Lima" })
    .getByRole("button", { name: "Edit" })
    .click()
  const edit = page.getByRole("dialog", { name: "Edit" })
  await expect(edit.getByRole("textbox", { name: "Client" })).toHaveValue(
    "Boris Lima"
  )
  await edit.getByRole("textbox", { name: "Amount" }).fill("4500")
  await edit.getByRole("radio", { name: "talks" }).click()
  await shot("app-deals-edit")
  await edit.getByRole("button", { name: "Save" }).click()
  await expect(edit).toBeHidden()
  const boris = rows.filter({ hasText: "Boris Lima" })
  await expect(boris).toContainText("4500")
  await expect(boris).toContainText("talks")

  // One that sends at once, and one that asks first.
  await boris.getByRole("button", { name: "Won" }).click()
  await expect(rows).toHaveCount(2)
  await rows
    .filter({ hasText: "Anna Weber" })
    .getByRole("button", { name: "Delete" })
    .click()
  const asks = page.getByRole("alertdialog")
  await expect(asks).toContainText("Delete this deal?")
  await shot("app-deals-asks")
  await asks.getByRole("button", { name: "Cancel" }).click()
  await expect(rows).toHaveCount(2)
  await rows
    .filter({ hasText: "Anna Weber" })
    .getByRole("button", { name: "Delete" })
    .click()
  await asks.getByRole("button", { name: "Delete" }).click()
  await expect(pane.getByText("No deals here yet")).toBeVisible()
  expect(call(window, "deals.list", {})).toHaveLength(3)

  // A form in a dialog adds one, with what the App wrote for its fields.
  await pane.getByRole("button", { name: "Add a deal" }).click()
  const add = page.getByRole("dialog", { name: "Add a deal" })
  await add.getByRole("textbox", { name: "Client" }).fill("Emil Sørensen")
  await add.getByRole("textbox", { name: "Amount" }).fill("9000")
  await add.getByRole("textbox", { name: "Due" }).fill("2031-05-01")
  await shot("app-deals-add")
  await add.getByRole("button", { name: "Add deal" }).click()
  // It closes once the deal is added.
  await expect(add).toBeHidden()
  await expect(rows.nth(1)).toContainText("Emil Sørensen")

  // Another tab draws the charts, and an Accordion opens.
  await pane.getByRole("tab", { name: "By stage" }).click()
  await expect(pane.getByText("Amount by stage, €")).toBeVisible()
  await expect(pane.locator("[data-slot=tree-chart] svg").first()).toBeVisible()
  await pane.getByRole("button", { name: "How the stages go" }).click()
  await expect(pane.getByText("A deal is")).toBeVisible()
  await shot("app-deals-charts")
})
