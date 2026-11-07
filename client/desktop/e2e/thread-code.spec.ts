import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { firstThread, read, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

test("a reply's code block wraps its lines, copies its code, and a shell's line runs in a terminal", async () => {
  window = await startWindow()
  const { app, page, dir } = window
  const project = join(dir, "root", "Work")
  const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText())
  const { thread, composer } = await firstThread(page)
  const wide = `const wide = "${"x".repeat(400)}"`
  await composer.fill(
    [
      // The reply starts with “You said: ”, so a fence cannot.
      "Some code:",
      "```bash\necho hello-there >> said.txt\n```",
      "```sh\ncd here\nls\n```",
      "```ts\n" + wide + "\n```",
    ].join("\n\n")
  )
  await composer.press("Enter")
  const blocks = thread.locator("[data-quotable] [data-streamdown=code-block]")
  await expect(blocks).toHaveCount(3)
  const [line, two, code] = [blocks.nth(0), blocks.nth(1), blocks.nth(2)]
  const run = (block: typeof line) =>
    block.getByRole("button", { name: "Run", exact: true })

  // Run is offered on one line of a shell only.
  await expect(run(line)).toHaveAttribute(
    "title",
    "Run in terminal: echo hello-there >> said.txt"
  )
  await expect(run(two)).toHaveCount(0)
  await expect(run(code)).toHaveCount(0)

  // Wrap lines: the long line goes on below, and back.
  const wrap = code.getByRole("button", { name: "Wrap lines" })
  const body = code.locator("[data-streamdown=code-block-body]")
  const pre = code.locator("pre")
  const overflows = () =>
    body.evaluate((element) => element.scrollWidth > element.clientWidth)
  await expect(wrap).toHaveAttribute("aria-pressed", "false")
  await expect.poll(overflows).toBe(true)
  await wrap.click()
  await expect(wrap).toHaveAttribute("aria-pressed", "true")
  await expect(pre).toHaveCSS("white-space", "pre-wrap")
  await expect.poll(overflows).toBe(false)
  await page.screenshot({ path: "test-results/thread-code.png" })

  // The menu: Copy code, Wrap lines as it is, no Run where there is none.
  const menu = page.getByRole("menu", { name: "Thread" })
  await code.locator("code").click({ button: "right" })
  await expect(menu.getByRole("menuitem", { name: "Copy code" })).toBeVisible()
  await expect(
    menu.getByRole("menuitemcheckbox", { name: "Wrap lines" })
  ).toBeChecked()
  await expect(
    menu.getByRole("menuitem", { name: "Run in terminal" })
  ).toHaveCount(0)
  await menu.getByRole("menuitemcheckbox", { name: "Wrap lines" }).click()
  await expect(menu).toBeHidden()
  await expect(wrap).toHaveAttribute("aria-pressed", "false")
  await code.locator("code").click({ button: "right" })
  await menu.getByRole("menuitem", { name: "Copy code" }).click()
  await expect(menu).toBeHidden()
  // As the block's own Copy does: with the line's end.
  await expect.poll(clipboard).toBe(`${wide}\n`)

  // Run in terminal: a terminal beside the Thread, in the Project's folder,
  // runs the line.
  await line.locator("code").click({ button: "right" })
  await menu.getByRole("menuitem", { name: "Run in terminal" }).click()
  await expect(menu).toBeHidden()
  const screen = page.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  await expect.poll(() => read(join(project, "said.txt"))).toBe("hello-there\n")
  // The line typed is forgotten, and the shell goes on.
  await expect(screen).toHaveAttribute("data-state", "running")
})
