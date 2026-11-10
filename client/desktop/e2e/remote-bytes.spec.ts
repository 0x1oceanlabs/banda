/**
 * The bytes a Pane draws, from the engine of the machine whose file it is
 * (ADR 0106, decision 6). The page asks its session's engine for a token
 * (`bytes.issue`), and main relays `app://files/<token>` and
 * `app://preview/<token>` to that engine, reading no file itself.
 *
 * This machine's road (`bytes-here`, step 4b): with arc beside it, whose
 * "Same" holds files of its own at the same path where arc has a mount
 * namespace (arc.ts), a picture in this machine's reply, a PDF and a video
 * in Quick Look and a page in its frame are this machine's: the picture is
 * this machine's 1×1, never arc's 3×2, and the page says "mac". Arc's
 * bytes come with step 4c, and their tests join this spec then.
 *
 * With BANDA_E2E_SHOTS set to a folder, it leaves pictures of Quick Look's
 * PDF and video there, which show no change from before the relay.
 */
import { copyFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { type Arc, newArc, put, withArc } from "./arc"
import { pdfOf } from "./pdf"
import { setInFront, type Window } from "./window"

const shots = process.env.BANDA_E2E_SHOTS

let window: Window | undefined
let arc: Arc | undefined
let stopArc: (() => Promise<void>) | undefined

test.afterEach(async () => {
  await window?.close()
  await stopArc?.()
  arc?.close()
  window = arc = stopArc = undefined
})

/** The title of this machine's Thread in "Same". */
const TITLE = "Bench bytes here"

/** Two grey PNGs, told apart by their sizes. */
const PNG_3X2 =
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAADklEQVR4nGNogAEGOAsAWhQJAbISPYcAAAAASUVORK5CYII="
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNoaGgAAAMEAYFL09IQAAAAAElFTkSuQmCC"

/** A page that says whose it is, by a script that runs in its frame. */
const pageOf = (who: string) =>
  `<!doctype html><title>Whose</title><p id="who"></p><script>document.getElementById("who").textContent = ${JSON.stringify(who)}</script>`

/**
 * "Same" on both machines, arc's with its own who.png and page, and this
 * machine's with its own, a PDF and a video; this machine's Thread in it
 * done, open from the sidebar. arc's engine runs, so a byte that went to
 * it would show arc's file.
 */
async function openedHere() {
  arc = newArc({ latency: 40 })
  stopArc = await arc.start()
  const there = join(arc.code.arc, "Same")
  const here = join(arc.code.here, "Same")
  put(arc.disk(there), { "page.html": pageOf("arc") })
  writeFileSync(
    arc.disk(join(there, "who.png")),
    Buffer.from(PNG_3X2, "base64")
  )
  arc.banda("project", "add", there)
  put(here, { "page.html": pageOf("mac") })
  writeFileSync(join(here, "who.png"), Buffer.from(PNG_1X1, "base64"))
  writeFileSync(
    join(here, "spec.pdf"),
    // Large enough to be read in ranges.
    pdfOf(
      [
        ["Chapter 1", "This machine's PDF."],
        ["Chapter 2", "Nothing to see here."],
      ],
      300_000
    )
  )
  copyFileSync(join(import.meta.dirname, "media.webm"), join(here, "clip.webm"))
  window = await withArc(arc)
  const { page } = window
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  // This machine's engine runs once the window's list is drawn.
  await expect(sidebar.getByText("Nothing waits for you")).toBeVisible()
  const project = JSON.parse(window.banda("project", "add", here)).ok
    .id as string
  window.banda(
    "call",
    "agents.send",
    "--project",
    project,
    "--params",
    JSON.stringify({ harness: "fake", text: TITLE, settings: null })
  )
  // A Project added from outside shows as the window comes to the front.
  await setInFront(page, false)
  await setInFront(page, true)
  await sidebar.getByText(TITLE).click()
  const thread = page.getByRole("region", { name: TITLE, exact: true })
  await expect(thread.getByText(`You said: ${TITLE}`)).toBeVisible()
  const composer = thread.getByRole("textbox", { name: "Message to Fake AI" })
  return { page, thread, composer }
}

/** Files beside the Thread, on its Project's folder; a row of its tree
 * by its name. */
async function filesBeside(page: Page, composer: Locator) {
  await composer.focus()
  await page.keyboard.press("Alt+e")
  const files = page
    .locator("section")
    .filter({ has: page.getByRole("navigation", { name: "Places" }) })
  await expect(files).toHaveAttribute("data-focused", "true")
  const tree = files.getByRole("tree")
  return (name: string) => tree.getByRole("treeitem", { name, exact: true })
}

/** Quick Look on `row`, by Space; its tile. */
async function quickLook(page: Page, row: Locator, name: string) {
  await row.click()
  await expect(row).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Space")
  const peek = page.locator("[data-peek]")
  await expect(peek).toHaveAttribute("aria-label", `Quick Look: ${name}`)
  return peek
}

/** A picture of the window into `shots`, once nothing moves. */
async function shot(page: Page, name: string) {
  if (!shots) return
  await page.mouse.move(900, 700)
  await page.waitForTimeout(1_500)
  await page.screenshot({ path: join(shots, `${name}.png`) })
}

test("bytes-here: a picture in this machine's reply is this machine's, through the relay to its engine, though arc's at the same path is another", async () => {
  const { thread, composer } = await openedHere()
  await composer.fill("![who](who.png)")
  await composer.press("Enter")
  const picture = thread.locator('[data-quotable] img[alt="who"]')
  await expect(picture).toHaveAttribute("src", /^app:\/\/files\/\w+$/)
  await expect
    .poll(() =>
      picture.evaluate((image: HTMLImageElement) => image.naturalWidth)
    )
    .toBe(1)
})

test("bytes-here: Quick Look draws this machine's PDF and plays its video, seeking, in ranges the engine cuts, through the relay", async () => {
  const { page, composer } = await openedHere()
  const row = await filesBeside(page, composer)

  const pdf = await quickLook(page, row("spec.pdf"), "spec.pdf")
  const first = pdf.locator('[data-pdf-page="1"]')
  await expect(first.locator("[data-pdf-text]")).toContainText("Chapter 1")
  await expect
    .poll(() =>
      first
        .locator("canvas")
        .evaluate((canvas: HTMLCanvasElement) => canvas.width)
    )
    .toBeGreaterThan(0)
  await shot(page, "quick-look-pdf-here")
  await page.keyboard.press("Escape")
  await expect(pdf).toBeHidden()

  const peek = await quickLook(page, row("clip.webm"), "clip.webm")
  const video = peek.locator("video")
  await expect(video).toHaveAttribute("src", /^app:\/\/files\/\w+$/)
  await expect
    .poll(() => video.evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(1)
  // A range goes to the engine and comes back as it cut it: main passes
  // the header on and serves nothing of its own.
  const ranged = await video.evaluate(async (video: HTMLVideoElement) => {
    const answer = await fetch(video.src, { headers: { range: "bytes=0-15" } })
    return [answer.status, (await answer.arrayBuffer()).byteLength]
  })
  expect(ranged).toEqual([206, 16])
  // Seekable only as the engine answers ranges, through the relay.
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
  await shot(page, "quick-look-video-here")
})

test("bytes-here: this machine's page runs in its frame from the sandbox host, and says it is this machine's", async () => {
  const { page, composer } = await openedHere()
  const row = await filesBeside(page, composer)
  const peek = await quickLook(page, row("page.html"), "page.html")
  const frame = peek.locator("iframe")
  await expect(frame).toHaveAttribute("src", /^app:\/\/preview\/\w+$/)
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts")
  await expect(frame.contentFrame().locator("#who")).toHaveText("mac")
})
