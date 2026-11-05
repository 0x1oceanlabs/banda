import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

test("a reply's selection copies as Markdown, and as HTML beside it", async () => {
  window = await startWindow()
  const { app, page } = window
  const copied = () => app.evaluate(({ clipboard }) => clipboard.readText())
  const copiedHtml = () =>
    app.evaluate(async ({ clipboard }) => {
      const [item] = await clipboard.read()
      return item?.types.includes("text/html")
        ? await (await item.getType("text/html")).text()
        : ""
    })
  const { thread, composer } = await firstThread(page)
  await composer.fill(
    [
      "Intro with **bold**, _em_, `code` and [a page](https://example.com/x) cited[^n].",
      "- one\n- two",
      "1. first\n2. second",
      "| A | B |\n|---|---|\n| 1 | 2 |",
      "```ts\nconst a = 1\nconst b = 2\n```",
      "Math $x^2$ inline.",
      "```mermaid\ngraph TD; A-->B\n```",
      "[^n]: The note.",
    ].join("\n\n")
  )
  await composer.press("Enter")
  const reply = thread.locator("[data-quotable]")
  await expect(reply.locator("table")).toBeVisible()
  await expect(reply.getByRole("img", { name: "Mermaid chart" })).toBeVisible()
  await page.screenshot({ path: "test-results/thread-copy.png" })
  const menu = page.getByRole("menu", { name: "Thread" })

  // All of it, by the keys.
  await reply.getByText("bold").click({ button: "right" })
  await menu.getByRole("menuitem", { name: "Select reply" }).click()
  await expect(menu).toBeHidden()
  await page.keyboard.press("Control+C")
  await expect
    .poll(copied)
    .toBe(
      [
        "You said: Intro with **bold**, *em*, `code` and [a page](https://example.com/x) cited[^n].",
        "- one\n- two",
        "1. first\n2. second",
        "| A | B |\n| - | - |\n| 1 | 2 |",
        "```ts\nconst a = 1\nconst b = 2\n```",
        "Math $x^2$ inline.",
        "```mermaid\ngraph TD; A-->B\n```",
        "[^n]: The note.",
      ].join("\n\n")
    )
  const html = await copiedHtml()
  expect(html).toContain("<strong>bold</strong>")
  expect(html).toContain('<a href="https://example.com/x">a page</a>')
  expect(html).not.toContain("example.com)")

  // A part of two lists, by the menu: each part keeps its list.
  const select = (from: string, to: string) =>
    reply.evaluate(
      (element, [from, to]) => {
        const text = (words: string) => {
          const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
          while (walk.nextNode())
            if (walk.currentNode.textContent === words) return walk.currentNode
          throw new Error(words)
        }
        const range = document.createRange()
        range.setStart(text(from), 1)
        range.setEnd(text(to), 3)
        ;(document.activeElement as HTMLElement | null)?.blur()
        getSelection()!.removeAllRanges()
        getSelection()!.addRange(range)
      },
      [from, to]
    )
  await select("one", "second")
  await reply.getByText("first").click({ button: "right" })
  await menu.getByRole("menuitem", { name: /^Copy/ }).click()
  await expect.poll(copied).toBe("- ne\n- two\n\n1. first\n2. sec")
  await select("one", "two")
  await page.keyboard.press("Control+C")
  await expect.poll(copied).toBe("- ne\n- two")

  // Code's own words stay as they are.
  await reply.locator("pre").evaluate((pre) => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    getSelection()!.selectAllChildren(pre)
  })
  await page.keyboard.press("Control+C")
  await expect.poll(copied).toBe("const a = 1\nconst b = 2")
})
