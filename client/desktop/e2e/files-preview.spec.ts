import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { crc32 } from "node:zlib"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { pdfOf } from "./pdf"
import {
  firstThread,
  projectId,
  startWindow,
  textOf,
  type Window,
} from "./window"

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

/** Files beside the Thread, on the Project's folder, once the Thread has
 * the keys; a row of its tree by its name. */
async function filesBeside(page: Page, thread: Locator) {
  await expect(thread).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+e")
  const files = page
    .locator("section")
    .filter({ has: page.getByRole("navigation", { name: "Places" }) })
  await expect(files).toHaveAttribute("data-focused", "true")
  const tree = files.getByRole("tree")
  return (name: string) => tree.getByRole("treeitem", { name, exact: true })
}

/** The file of the row picked in Quick Look, by Space; then, by ↵, in a
 * Pane of its own. */
async function lookThenOpen(
  page: Page,
  row: Locator,
  name: string,
  look: (peek: Locator) => Promise<void>
): Promise<Locator> {
  await row.click()
  await expect(row).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Space")
  const peek = page.locator("[data-peek]")
  await expect(peek).toHaveAttribute("aria-label", `Quick Look: ${name}`)
  await look(peek)
  await page.keyboard.press("Enter")
  await expect(peek).toBeHidden()
  const pane = page.getByRole("region", { name, exact: true })
  await expect(pane).toBeVisible()
  return pane
}

/** A zip of `files`, each stored as it is, written here so no test
 * carries one; a name that ends in `/` is a folder. */
function zipOf(files: Record<string, string>): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text)
    const named = Buffer.from(name)
    const sum = crc32(data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt32LE(sum, 14)
    head.writeUInt32LE(data.length, 18)
    head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(named.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt32LE(sum, 16)
    entry.writeUInt32LE(data.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(named.length, 28)
    entry.writeUInt32LE(offset, 42)
    local.push(head, named, data)
    central.push(entry, named)
    offset += head.length + named.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}

/** A PNG of one pixel, as a notebook keeps a plot. */
const DOT =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="

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

  // While it shows, the sidebar's Search opens the Banda menu: only the
  // menu's key fills the desk.
  await row("a.ts").click()
  await page.keyboard.press("Space")
  await expect(peek).toHaveAttribute("aria-label", "Quick Look: a.ts")
  await page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("button", { name: /Search/ })
    .click()
  await expect(page.getByRole("dialog", { name: "Banda menu" })).toBeVisible()
  await expect(peek).not.toHaveAttribute("data-fill")
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
  const { page, dir } = window
  await firstThread(page)
  const project = join(dir, "root", "Work")
  put(project, "secret.txt", "the secret\n")
  // A real link to a file, as only Banda's page gets one.
  const work = projectId(window, "Work")
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
  await expect(menu.getByRole("menuitemradio")).toHaveText([
    "Markdown",
    "Code",
    "Hex",
  ])
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

test("a CSV of 100 000 rows shows in Quick Look, its quoted cells whole, and scrolls to its end in its Pane", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread } = await firstThread(page)
  const project = join(dir, "root", "Work")
  const rows = ["id,name,amount,notes"]
  for (let n = 1; n <= 100_000; n++)
    rows.push(
      `${n},Customer ${n},${(n % 997) + 0.5},${n === 2 ? '"said ""hi""\nthen, left"' : ""}`
    )
  put(project, "orders.csv", rows.join("\r\n") + "\r\n")

  const row = await filesBeside(page, thread)
  const pane = await lookThenOpen(
    page,
    row("orders.csv"),
    "orders.csv",
    async (peek) => {
      const table = peek.getByRole("table", { name: "orders.csv" })
      await expect(table.getByRole("columnheader")).toHaveText([
        "id",
        "name",
        "amount",
        "notes",
      ])
      await expect(
        table.getByRole("cell", { name: "Customer 1", exact: true })
      ).toBeVisible()
      // A quoted cell keeps its comma, its quotes and its line break.
      await expect(
        table.getByRole("cell", { name: 'said "hi" ↵ then, left' })
      ).toBeVisible()
      await page.screenshot({ path: "test-results/files-table.png" })
    }
  )
  await expect(
    pane.getByText("100,000 rows · 4 columns · parted by commas")
  ).toBeVisible()
  const table = pane.getByRole("table", { name: "orders.csv" })
  await table.evaluate((list) => (list.scrollTop = list.scrollHeight))
  await expect(
    table.getByRole("rowheader", { name: "100000", exact: true })
  ).toBeVisible()
  await expect(
    table.getByRole("cell", { name: "Customer 100000", exact: true })
  ).toBeVisible()
})

test("a JSON shows as a tree that folds, and a row copies its path", async () => {
  window = await startWindow()
  const { app, page, dir } = window
  const { thread } = await firstThread(page)
  const project = join(dir, "root", "Work")
  put(
    project,
    "data.json",
    JSON.stringify(
      {
        name: "banda",
        users: [
          { id: 1, name: "Ada" },
          { id: 2, name: "Linus" },
        ],
      },
      null,
      2
    )
  )
  const row = await filesBeside(page, thread)
  const pane = await lookThenOpen(
    page,
    row("data.json"),
    "data.json",
    async (peek) => {
      await expect(peek.getByRole("tree", { name: "data.json" })).toBeVisible()
      await expect(peek.locator('[data-path=".users[1].name"]')).toContainText(
        '"Linus"'
      )
    }
  )
  const tree = pane.getByRole("tree", { name: "data.json" })
  const users = tree.locator('[data-path=".users"]')
  await expect(users).toHaveAttribute("aria-expanded", "true")
  await users.getByRole("button", { name: "Fold" }).click()
  await expect(users).toHaveAttribute("aria-expanded", "false")
  await expect(tree.locator('[data-path=".users[0]"]')).toHaveCount(0)
  await expect(users).toContainText("[…] 2 items")
  await users.getByRole("button", { name: "Unfold" }).click()
  const name = tree.locator('[data-path=".users[0].name"]')
  await name.click()
  await expect(name).toHaveAttribute("aria-selected", "true")
  await name.getByRole("button", { name: "Copy path" }).click()
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe(".users[0].name")
  // Its source is a toggle away.
  await pane.getByRole("button", { name: "Source" }).click()
  await expect(pane.locator('[data-line="1"]').first()).toContainText("{")
})

test("a notebook shows its markdown, its code and an image it saved, and runs nothing", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread } = await firstThread(page)
  const project = join(dir, "root", "Work")
  const notebook = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { language: "python", name: "python3" } },
    cells: [
      {
        cell_type: "markdown",
        metadata: {},
        source: ["# Sales by city\n", "A **plot** below."],
      },
      {
        cell_type: "code",
        execution_count: 2,
        metadata: {},
        source: ["import matplotlib.pyplot as plt\n", "plt.plot([1, 2])"],
        outputs: [
          { output_type: "stream", name: "stdout", text: ["drawn\n"] },
          {
            output_type: "display_data",
            metadata: {},
            data: { "image/png": DOT, "text/plain": ["<Figure>"] },
          },
          {
            output_type: "display_data",
            metadata: {},
            data: {
              "text/html": [
                "<table><tr><td>Berlin</td></tr></table><script>window.ran = 1</script>",
              ],
              "text/plain": ["Berlin"],
            },
          },
        ],
      },
    ],
  }
  put(project, "study.ipynb", JSON.stringify(notebook))
  const row = await filesBeside(page, thread)
  const pane = await lookThenOpen(
    page,
    row("study.ipynb"),
    "study.ipynb",
    async (peek) => {
      await expect(
        peek.getByRole("heading", { name: "Sales by city" })
      ).toBeVisible()
    }
  )
  await expect(
    pane.getByText("Saved outputs only. Code is never executed.")
  ).toBeVisible()
  await expect(
    pane.locator('[data-cell="code"] [data-line="1"]').first()
  ).toContainText("import matplotlib.pyplot as plt")
  await expect(pane.getByText("drawn", { exact: true })).toBeVisible()
  const image = pane.getByRole("img", { name: "An output" })
  await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/)
  await expect
    .poll(() => image.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(1)
  // HTML that needs its scripts shows its text, and nothing ran.
  await expect(
    pane.getByText("This output needs its scripts, which Files does not run.")
  ).toBeVisible()
  expect(
    await page.evaluate(() => (window as unknown as { ran?: number }).ran)
  ).toBeUndefined()
  await page.screenshot({ path: "test-results/files-notebook.png" })
})

test("a font shows its family name, and words typed in it", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread } = await firstThread(page)
  const project = join(dir, "root", "Work")
  mkdirSync(project, { recursive: true })
  // A font of pdf.js's own, so no test carries one.
  const pdfjs = createRequire(
    join(import.meta.dirname, "../../../apps/files/pane/package.json")
  )
  copyFileSync(
    pdfjs.resolve("pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"),
    join(project, "Liberation.ttf")
  )
  const row = await filesBeside(page, thread)
  const pane = await lookThenOpen(
    page,
    row("Liberation.ttf"),
    "Liberation.ttf",
    async (peek) => {
      await expect(
        peek.getByRole("heading", { name: "Liberation Sans" })
      ).toBeVisible()
    }
  )
  await expect(pane.getByText(/^Regular · \d+ glyphs/)).toBeVisible()
  await pane.getByRole("textbox", { name: "Words to try" }).fill("Banda")
  await expect(
    pane.getByLabel("Sizes").getByText("Banda", { exact: true })
  ).toHaveCount(6)
  // The heading is drawn in the font itself.
  const family = await pane
    .getByRole("heading", { name: "Liberation Sans" })
    .evaluate((heading) => getComputedStyle(heading).fontFamily)
  expect(family).toMatch(/^"?banda-font-\d+/)
  await page.screenshot({ path: "test-results/files-font.png" })
})

test("a zip lists what it holds as a tree with sizes, a name that climbs out as only text", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread } = await firstThread(page)
  const project = join(dir, "root", "Work")
  put(
    project,
    "site.zip",
    zipOf({
      "docs/": "",
      "docs/a.md": "# Notes\n",
      "hello.txt": "hello",
      "../x": "out",
    })
  )
  const row = await filesBeside(page, thread)
  const pane = await lookThenOpen(
    page,
    row("site.zip"),
    "site.zip",
    async (peek) => {
      await expect(peek.getByRole("treeitem", { name: "a.md" })).toBeVisible()
    }
  )
  await expect(pane.getByText(/^Zip · 3 files in 2 folders/)).toBeVisible()
  for (const name of ["docs", "a.md", "hello.txt", "..", "x"])
    await expect(
      pane.getByRole("treeitem", { name, exact: true })
    ).toBeVisible()
  await pane.getByRole("treeitem", { name: "hello.txt" }).click()
  await expect(
    pane.getByText("hello.txt · 5 bytes · 5 bytes packed")
  ).toBeVisible()
  await page.screenshot({ path: "test-results/files-archive.png" })
})

test("an unknown binary shows its bytes as hex under its facts, and Ctrl+G goes to an offset", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread } = await firstThread(page)
  const project = join(dir, "root", "Work")
  const bytes = Buffer.alloc(64 * 1024)
  bytes.write("Hello, bytes!", 0x9000)
  for (let n = 0; n < 256; n++) bytes[n] = n
  put(project, "blob.bin", bytes)
  const row = await filesBeside(page, thread)
  const pane = await lookThenOpen(
    page,
    row("blob.bin"),
    "blob.bin",
    async (peek) => {
      await expect(peek.getByLabel("Facts")).toContainText(
        "application/octet-stream"
      )
      const first = peek.getByLabel("Bytes").locator('[data-row="0"]')
      await expect(first.locator("[data-offset]")).toHaveText([
        ...Array.from({ length: 16 }, (_, n) =>
          n.toString(16).padStart(2, "0")
        ),
        ...Array.from({ length: 16 }, () => "·"),
      ])
    }
  )
  await expect(pane.getByLabel("Facts")).toContainText("66 KB (65,536 bytes)")
  const grid = pane.getByLabel("Bytes")
  await grid.click()
  await expect(grid).toBeFocused()
  await page.keyboard.press("ControlOrMeta+KeyG")
  const field = pane.getByRole("textbox", { name: "Go to offset" })
  await expect(field).toBeFocused()
  await field.fill("0x9000")
  await field.press("Enter")
  await expect(field).toBeHidden()
  await expect(pane.getByLabel("Marked byte")).toHaveText(
    "0x9000 (36,864) = 48"
  )
  await expect(
    grid.locator("[data-row]").filter({ hasText: "00009000" })
  ).toContainText("Hello, b")
  await page.screenshot({ path: "test-results/files-hex.png" })
})
