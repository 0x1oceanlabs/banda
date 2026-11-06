import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { pdfOf } from "./pdf"
import { firstThread, startWindow, textOf, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** Writes `text` at `path` under `folder`, its folders first. */
function put(folder: string, path: string, text: string | Buffer = "") {
  mkdirSync(join(folder, path, ".."), { recursive: true })
  writeFileSync(join(folder, path), text)
}

/** Opens the file the Banda menu finds for `words` in its Pane. */
async function openFromMenu(page: Page, words: string, title: string) {
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  await page.keyboard.press("Alt+Space")
  await menu.getByRole("combobox", { name: "Search" }).fill(words)
  const files = menu.getByRole("group", { name: "Files" })
  await expect(files.getByRole("option").first()).toContainText(title)
  await files.getByRole("option").first().click()
  await expect(menu).toBeHidden()
  const pane = page.getByRole("region", { name: title, exact: true })
  await expect(pane).toBeVisible()
  return pane
}

test("Quick Look shows the row picked over the desk on Space, follows ↓ in the same view, fills the desk, closes on Escape, and ↵ opens it as a Pane", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread } = await firstThread(page)
  const project = join(dir, "root", "Work")
  put(project, "src/a.ts", "export const a = 1\n")
  put(project, "src/b.ts", "export const b = 2\n")
  put(project, "README.md", "# Work\n")

  // Files beside the Thread, once the Thread has the keys.
  await expect(thread).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+e")
  const files = page
    .locator("section")
    .filter({ has: page.getByRole("navigation", { name: "Places" }) })
  await expect(files).toHaveAttribute("data-focused", "true")
  const tree = files.getByRole("tree")
  const row = (name: string) =>
    tree.getByRole("treeitem", { name, exact: true })
  // The keys move the pick, as they will under Quick Look.
  await row("src").click()
  await expect(row("a.ts")).toBeVisible()
  await page.keyboard.press("ArrowDown")
  await expect(row("a.ts")).toHaveAttribute("aria-selected", "true")
  const columns = await page.locator("[data-column]").count()

  // Space: the file over the desk, the tiling as it was, the keys the
  // tree's.
  await page.keyboard.press("Space")
  const peek = page.locator("[data-peek]")
  await expect(peek).toHaveAttribute("aria-label", "Quick Look: a.ts")
  await expect(peek.locator('[data-line="1"]').first()).toContainText(
    "export const a"
  )
  await expect(page.locator("[data-column]")).toHaveCount(columns)
  await expect(files).toHaveAttribute("data-focused", "true")
  await page.screenshot({ path: "test-results/files-quick-look.png" })

  // ↓ moves the pick under it, and the tile follows in the same view.
  const view = peek.locator("[data-code-view]")
  await view.evaluate((element) => element.setAttribute("data-was", ""))
  await page.keyboard.press("ArrowDown")
  await expect(row("b.ts")).toHaveAttribute("aria-selected", "true")
  await expect(peek).toHaveAttribute("aria-label", "Quick Look: b.ts")
  await expect(peek.locator('[data-line="1"]').first()).toContainText(
    "export const b"
  )
  await expect(peek.locator("[data-code-view][data-was]")).toHaveCount(1)

  // Its key in the Banda menu's place fills the desk, and floats it again.
  await page.keyboard.press("Alt+Space")
  await expect(peek).toHaveAttribute("data-fill", "true")
  await expect(page.getByRole("dialog", { name: "Banda menu" })).toBeHidden()
  await page.keyboard.press("Alt+Space")
  await expect(peek).not.toHaveAttribute("data-fill")

  // Escape closes it; Space again shows it; Space closes it.
  await page.keyboard.press("Escape")
  await expect(peek).toBeHidden()
  await page.keyboard.press("Space")
  await expect(peek).toBeVisible()
  await page.keyboard.press("Space")
  await expect(peek).toBeHidden()

  // ↵ opens it as a Pane of its own, beside, and Quick Look closes.
  await page.keyboard.press("Space")
  await expect(peek).toBeVisible()
  await page.keyboard.press("Enter")
  await expect(peek).toBeHidden()
  const pane = page.getByRole("region", { name: "b.ts", exact: true })
  await expect(pane.locator('[data-line="1"]').first()).toContainText(
    "export const b"
  )
  await expect(page.locator("[data-column]")).toHaveCount(columns + 1)
})

test("a PDF draws its first page from ranges of the file host, and Ctrl+F finds a word in it", async () => {
  window = await startWindow()
  const { page, dir } = window
  await firstThread(page)
  const project = join(dir, "root", "Work")
  const pages = Array.from({ length: 6 }, (_, n) => [
    `Chapter ${n + 1}`,
    n === 3 ? "A wallaby hides on page four." : "Nothing to see here.",
  ])
  // Large enough to be read in ranges.
  put(project, "spec.pdf", pdfOf(pages, 300_000))

  const pane = await openFromMenu(page, "spec.pdf", "spec.pdf")
  const first = pane.locator('[data-pdf-page="1"]')
  await expect(first.locator("[data-pdf-text]")).toContainText("Chapter 1")
  await expect
    .poll(() =>
      first
        .locator("canvas")
        .evaluate((canvas: HTMLCanvasElement) => canvas.width)
    )
    .toBeGreaterThan(0)
  await expect(pane.getByLabel("Page", { exact: true })).toHaveText("1 / 6")
  await page.screenshot({ path: "test-results/files-pdf.png" })

  await pane.getByLabel("Pages", { exact: true }).click()
  await page.keyboard.press("Control+KeyF")
  const find = pane.getByRole("textbox", { name: "Find in PDF" })
  await expect(find).toBeFocused()
  await find.fill("wallaby")
  await expect(pane.getByText("1 of 1")).toBeVisible()
  await expect(
    pane.locator('[data-pdf-page="4"] [data-pdf-text]')
  ).toContainText("wallaby")
  await find.fill("chapter")
  await expect(pane.getByText("1 of 6")).toBeVisible()
  await find.press("Enter")
  await expect(pane.getByText("2 of 6")).toBeVisible()
  await find.press("Escape")
  await expect(find).toBeHidden()
})

test("a video plays from the file host with its controls, and seeks in ranges", async () => {
  window = await startWindow()
  const { page, dir } = window
  await firstThread(page)
  const project = join(dir, "root", "Work")
  mkdirSync(join(project, "media"))
  copyFileSync(
    join(import.meta.dirname, "media.webm"),
    join(project, "media", "clip.webm")
  )
  const pane = await openFromMenu(page, "clip.webm", "clip.webm")
  const video = pane.locator("video")
  await expect(video).toHaveAttribute("src", /^app:\/\/files\//)
  await expect(video).toHaveAttribute("controls", "")
  await expect
    .poll(() => video.evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(1)
  // Seekable only as the host answers ranges.
  const seeked = await video.evaluate(
    (video: HTMLVideoElement) =>
      new Promise<[number, number]>((done) => {
        video.addEventListener(
          "seeked",
          () => done([video.seekable.end(0), video.currentTime]),
          { once: true }
        )
        video.currentTime = video.duration / 2
      })
  )
  expect(seeked[0]).toBeGreaterThan(0)
  expect(seeked[1]).toBeGreaterThan(0)
  await page.screenshot({ path: "test-results/files-video.png" })
})

test("an HTML file runs in the sandbox host, where its script reaches neither Banda nor the file host, and its source is a toggle away", async () => {
  window = await startWindow()
  const { page, dir, banda } = window
  await firstThread(page)
  const project = join(dir, "root", "Work")
  put(project, "secret.txt", "the secret\n")
  // A real link to a file, as only Banda's page gets one.
  const listed = JSON.parse(banda("call", "projects.list")) as {
    ok: { id: string; name: string }[]
  }
  const work = listed.ok.find((one) => one.name === "Work")!.id
  const link = await page.evaluate(
    ([project, path]) =>
      (
        window as unknown as {
          banda: { files: { url: (p: string, f: string) => Promise<string> } }
        }
      ).banda.files.url(project, path),
    [work, "secret.txt"]
  )
  expect(link).toMatch(/^app:\/\/files\//)
  put(
    project,
    "site/index.html",
    `<!doctype html><title>Page</title><h1>Hello from a page</h1>
<p>ran <b id="ran">no</b> parent <b id="parent">?</b> banda <b id="banda">?</b> files <b id="files">?</b></p>
<script>
document.getElementById("ran").textContent = "yes"
try { document.getElementById("parent").textContent = String(window.parent.document.title) } catch { document.getElementById("parent").textContent = "blocked" }
try { document.getElementById("banda").textContent = typeof window.parent.banda } catch { document.getElementById("banda").textContent = "blocked" }
fetch(${JSON.stringify(link)}).then((r) => r.text()).then((t) => { document.getElementById("files").textContent = t }, () => { document.getElementById("files").textContent = "blocked" })
</script>`
  )
  const pane = await openFromMenu(page, "index.html", "index.html")
  const frame = pane.locator("iframe")
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts")
  await expect(frame).toHaveAttribute("src", /^app:\/\/preview\//)
  const shown = frame.contentFrame()
  await expect(
    shown.getByRole("heading", { name: "Hello from a page" })
  ).toBeVisible()
  await expect(shown.locator("#ran")).toHaveText("yes")
  await expect(shown.locator("#parent")).toHaveText("blocked")
  await expect(shown.locator("#banda")).toHaveText("blocked")
  await expect(shown.locator("#files")).toHaveText("blocked")
  await page.screenshot({ path: "test-results/files-page.png" })

  // Banda's own page gets nothing from the sandbox host.
  const src = (await frame.getAttribute("src"))!
  expect(
    await page.evaluate(
      (url) =>
        fetch(url).then(
          (r) => r.status,
          () => 0
        ),
      src
    )
  ).not.toBe(200)

  const source = pane.getByRole("button", { name: "Source" })
  await source.click()
  await expect(pane.locator('[data-line="1"]').first()).toContainText(
    "<!doctype html>"
  )
  await expect(frame).toHaveCount(0)
})

test("Open with… draws markdown as code, and keeps the pick for the extension", async () => {
  window = await startWindow()
  const { page, dir } = window
  await firstThread(page)
  const project = join(dir, "root", "Work")
  put(project, "guide.md", "# The guide\n")
  put(project, "notes.md", "# The notes\n")

  let pane = await openFromMenu(page, "guide.md", "guide.md")
  await expect(pane.getByRole("heading", { name: "The guide" })).toBeVisible()
  await pane.getByRole("button", { name: "Open with…" }).click()
  const menu = page.getByRole("menu", { name: "Open with…" })
  await expect(menu.getByRole("menuitemradio")).toHaveText(["Markdown", "Code"])
  await menu.getByRole("menuitemradio", { name: "Code" }).click()
  await expect(menu).toBeHidden()
  await expect(pane.locator('[data-line="1"]').first()).toContainText(
    "# The guide"
  )
  await expect(pane.getByRole("heading", { name: "The guide" })).toHaveCount(0)
  await expect
    .poll(() => textOf(join(dir, "config", "files.toml")))
    .toMatch(/^\[previewers\]\nmd = "files\.code"$/m)

  // Another markdown file opens as code too.
  pane = await openFromMenu(page, "notes.md", "notes.md")
  await expect(pane.locator('[data-line="1"]').first()).toContainText(
    "# The notes"
  )
  expect(readFileSync(join(dir, "config", "files.toml"), "utf8")).toContain(
    'md = "files.code"'
  )
})
