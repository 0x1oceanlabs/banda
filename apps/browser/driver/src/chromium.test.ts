/**
 * The driver on a real Chromium: only where `BANDA_CHROMIUM` names a
 * headless shell (`banda browser setup` fetches one). On a system that
 * refuses Chromium's sandbox to that program, `BANDA_CHROMIUM_SANDBOX=off`
 * starts it without, through the library's option for tests: the program
 * itself has none.
 */
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { createInterface } from "node:readline"
import { PassThrough } from "node:stream"
import { setTimeout as sleep } from "node:timers/promises"
import type { ReadTab, Screenshot, Shown } from "@banda/contract/browser"
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest"
import { browsers, type Calls, type Options } from "./browsers"
import { serve } from "./lines"

const CHROMIUM = process.env.BANDA_CHROMIUM
const SANDBOX = process.env.BANDA_CHROMIUM_SANDBOX !== "off"

const HOME = `<title>Home</title>
<style>body { margin: 0; background: rgb(200, 0, 0) }
#card { position: fixed; left: 0; top: 300px; width: 600px; height: 200px }</style>
<button onclick="out.textContent = 'Hello'">Greet</button>
<a href="/next">Next</a>
<a href="/popup" target="_blank">Open popup</a>
<a href="/file">Download</a>
<button onclick="out.textContent = 'Said ' + prompt('Name?', 'Roma')">Ask</button>
<form action="/next"><input name="name" aria-label="Name"></form>
<input id="card" type="password" aria-label="Password" value="hunter2secret">
<input aria-label="Card" autocomplete="cc-number" value="4111111111111111">
<select aria-label="Colour"><option>Red</option><option>Blue</option></select>
<p id="out"></p>
<script>
  setTimeout(() => document.body.append("Later"), 400)
  navigator.geolocation.getCurrentPosition(
    () => document.body.append("place given"),
    (error) => document.body.append("place refused " + error.code)
  )
</script>`

/** Reads the picture the test last took back in a page: the colour of a
 * point in the password field, and of one beside it. */
const PIXELS = `<title>Pixels</title><canvas></canvas><script>
  const image = new Image()
  image.onload = () => {
    const canvas = document.querySelector("canvas")
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext("2d")
    context.drawImage(image, 0, 0)
    const at = (x, y) => [...context.getImageData(x, y, 1, 1).data.slice(0, 3)].join(",")
    document.body.append("field " + at(300, 400) + " beside " + at(1000, 400))
  }
  image.src = "/shot.jpg"
</script>`

let server: Server
let origin: string
/** The picture `/shot.jpg` serves. */
let shot = Buffer.alloc(0)
let folder: string
const drivers: Calls[] = []

/** A driver of its own Chromiums, closed when its test is over. */
const driver = (options: Partial<Options> = {}) => {
  const calls = browsers(
    { chromium: CHROMIUM!, sandbox: SANDBOX, ...options },
    () => {}
  )
  drivers.push(calls)
  return calls
}

/** A profile's folder, and the folder its downloads go to. */
const profile = (name = "p") => ({
  profile: join(folder, name),
  downloads: join(folder, `${name}-downloads`),
})

/** The processes of the Chromium of the profile in `folder`. */
const running = (folder: string) =>
  execFileSync("ps", ["-eww", "-o", "pid=,args="], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.includes(`--user-data-dir=${folder}`))

/** Waits until `met`, for 10 s at most. */
const until = async (met: () => boolean | Promise<boolean>) => {
  for (let n = 0; n < 100; n++) {
    if (await met()) return
    await sleep(100)
  }
  throw new Error("It did not come within 10 s.")
}

const by = "agent-1"
const open = (calls: Calls, url = "/", where = profile()) =>
  calls.call("open", { ...where, url: origin + url, by }) as Promise<Shown>
const snapshot = (calls: Calls, tab: number) =>
  calls.call("snapshot", { tab, by }) as Promise<ReadTab>
const act = (calls: Calls, tab: number, what: object) =>
  calls.call("act", { tab, by, ...what }) as Promise<Shown>
/** The ref of the element `named` so in `tree`. */
const refOf = (tree: string, named: string) => {
  const ref = new RegExp(`${named}[^\\n]*\\[ref=(\\w+)\\]`).exec(tree)?.[1]
  if (!ref) throw new Error(`No ${named} in:\n${tree}`)
  return ref
}

describe.skipIf(!CHROMIUM)("the driver, on a real Chromium", () => {
  beforeAll(async () => {
    server = createServer((request, response) => {
      const { pathname } = new URL(request.url!, "http://localhost")
      const html = (body: string) =>
        response.setHeader("content-type", "text/html").end(body)
      if (pathname === "/") return html(HOME)
      if (pathname === "/next") return html("<title>Next</title>Next page")
      if (pathname === "/popup") return html("<title>Popup</title>A popup")
      if (pathname === "/pixels") return html(PIXELS)
      if (pathname === "/shot.jpg")
        return response.setHeader("content-type", "image/jpeg").end(shot)
      if (pathname === "/file")
        return response
          .setHeader("content-disposition", 'attachment; filename="report.txt"')
          .end("the report")
      if (pathname === "/cookie")
        return response
          .setHeader("set-cookie", "seen=1; Max-Age=3600; Path=/")
          .end("kept")
      if (pathname === "/whoami")
        return html(`cookie: ${request.headers.cookie ?? "none"}`)
      response.writeHead(404).end()
    })
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => void server.close())
  afterEach(async () => {
    await Promise.all(drivers.splice(0).map((calls) => calls.close()))
    rmSync(folder, { recursive: true, force: true })
  })
  // A folder of its own for each test's profiles and downloads.
  const fresh = () =>
    (folder = mkdtempSync(join(tmpdir(), "banda-browser-driver-")))

  test("a tab opens with the first id, is read with refs, and the next id follows", async () => {
    fresh()
    const calls = driver({ firstTab: 7 })
    const home = await open(calls)
    expect(home).toEqual({
      tab: 7,
      url: `${origin}/`,
      title: "Home",
      loading: false,
      moved: false,
      opened: [],
      dialog: null,
      download: null,
      touched: false,
    })
    const read = await snapshot(calls, 7)
    expect(read).toMatchObject({
      url: `${origin}/`,
      title: "Home",
      dialog: null,
    })
    expect(read.tree).toMatch(/button "Greet" \[ref=e\d+\]/)
    // Every permission a site asks for is refused.
    await calls.call("wait_for", { tab: 7, text: "place refused 1", by })
    // A blank tab, with no address.
    const blank = (await calls.call("open", { ...profile(), by })) as Shown
    expect(blank).toMatchObject({ tab: 8, url: "about:blank", title: "" })
    expect(await calls.call("tabs", { profile: profile().profile })).toEqual([
      { id: 7, url: `${origin}/`, title: "Home" },
      { id: 8, url: "about:blank", title: "" },
    ])
    expect(await calls.call("where", { tab: 7 })).toEqual({
      url: `${origin}/`,
      profile: profile().profile,
    })
    // Its Chromium is driven over a pipe: no port listens.
    const [browser] = running(profile().profile)
    expect(browser).toContain("--remote-debugging-pipe")
    expect(browser).not.toContain("--remote-debugging-port")
  })

  test("the hands click, fill and press, and say where the page went", async () => {
    fresh()
    const calls = driver()
    const { tab } = await open(calls)
    const { tree } = await snapshot(calls, tab)
    const greeted = await act(calls, tab, {
      action: "click",
      ref: refOf(tree, 'button "Greet"'),
    })
    expect(greeted).toMatchObject({ moved: false, url: `${origin}/` })
    expect((await snapshot(calls, tab)).tree).toContain("Hello")
    // Calls on one tab run in the order they came: the snapshot reads
    // what the fill before it typed.
    const name = refOf(tree, 'textbox "Name"')
    const [, filled] = await Promise.all([
      act(calls, tab, { action: "fill", ref: name, text: "Roma" }),
      snapshot(calls, tab),
    ])
    expect(filled.tree).toMatch(/textbox "Name"[^\n]*: Roma/)
    const sent = await act(calls, tab, {
      action: "press",
      ref: name,
      key: "Enter",
    })
    expect(sent).toMatchObject({
      moved: true,
      url: `${origin}/next?name=Roma`,
      title: "Next",
    })
    const back = (await calls.call("navigate", {
      tab,
      to: "back",
      by,
    })) as Shown
    expect(back).toMatchObject({ url: `${origin}/`, title: "Home" })
    const next = await act(calls, tab, {
      action: "click",
      ref: refOf((await snapshot(calls, tab)).tree, 'link "Next"'),
    })
    expect(next).toMatchObject({ moved: true, url: `${origin}/next` })
  })

  test("what is not so is refused in the window's words", async () => {
    fresh()
    const calls = driver()
    const { tab } = await open(calls)
    const { tree } = await snapshot(calls, tab)
    const refused = (work: Promise<unknown>) =>
      work.then(
        () => undefined,
        ({ code, message }: { code?: string; message: string }) => ({
          code,
          message,
        })
      )
    expect(await refused(snapshot(calls, 99))).toEqual({
      code: "not_found",
      message: "There is no tab 99: browser_tabs lists them.",
    })
    expect(
      await refused(calls.call("navigate", { tab, to: "back", by }))
    ).toEqual({
      code: undefined,
      message: `Tab ${tab} has nowhere to go back.`,
    })
    expect(
      await refused(act(calls, tab, { action: "click", ref: "e999" }))
    ).toEqual({
      code: undefined,
      message: "e999 is not on the page now: take a new snapshot.",
    })
    expect(
      await refused(
        act(calls, tab, {
          action: "select",
          ref: refOf(tree, 'combobox "Colour"'),
          values: ["Green"],
        })
      )
    ).toEqual({
      code: "invalid",
      message: `${refOf(tree, 'combobox "Colour"')} has no option "Green". Its options: "Red", "Blue".`,
    })
    expect(
      await refused(act(calls, tab, { action: "press", key: "Ctrl+A" }))
    ).toMatchObject({ code: "invalid" })
    expect(
      await refused(
        calls.call("navigate", { tab, to: "file:///etc/passwd", by })
      )
    ).toMatchObject({ code: "invalid" })
    expect(
      await refused(
        calls.call("wait_for", { tab, text: "Never there", seconds: 1, by })
      )
    ).toEqual({
      code: undefined,
      message: `Tab ${tab} did not show "Never there" within 1 s.`,
    })
    expect(await refused(calls.call("fly", {}))).toMatchObject({
      code: "invalid",
    })
    // An address that does not answer leaves no tab behind.
    expect(
      await refused(
        calls.call("open", { ...profile(), url: "http://127.0.0.1:1/", by })
      )
    ).toMatchObject({ code: undefined })
    expect(
      await calls.call("tabs", { profile: profile().profile })
    ).toHaveLength(1)
  })

  test("a prompt is held for an answer, and accepted with text", async () => {
    fresh()
    const calls = driver()
    const { tab } = await open(calls)
    const { tree } = await snapshot(calls, tab)
    const asked = await act(calls, tab, {
      action: "click",
      ref: refOf(tree, 'button "Ask"'),
    })
    expect(asked.dialog).toMatchObject({
      kind: "prompt",
      message: "Name?",
      default_prompt: "Roma",
      url: `${origin}/`,
    })
    const dialog = asked.dialog!.id
    // While it is open, a snapshot answers the dialog, and the hands wait.
    expect(await snapshot(calls, tab)).toEqual({
      url: `${origin}/`,
      title: "Home",
      tree: "",
      errors: [],
      dialog: asked.dialog,
    })
    await expect(
      act(calls, tab, { action: "click", ref: refOf(tree, 'button "Greet"') })
    ).rejects.toThrow(
      `The page waits for dialog ${dialog}. Take a snapshot and answer it first.`
    )
    await expect(calls.call("screenshot", { tab, by })).rejects.toThrow(
      "The page has an open dialog. Answer it before taking a screenshot."
    )
    await expect(
      act(calls, tab, { action: "dialog_dismiss", dialog, text: "Ada" })
    ).rejects.toThrow("Only accepting a prompt takes text.")
    const answered = await act(calls, tab, {
      action: "dialog_accept",
      dialog,
      text: "Ada",
    })
    expect(answered).toMatchObject({ moved: true, dialog: null, title: "Home" })
    expect((await snapshot(calls, tab)).tree).toContain("Said Ada")
    await expect(
      act(calls, tab, { action: "dialog_accept", dialog })
    ).rejects.toThrow("That page dialog is no longer open.")
  })

  test("a password and a card are hidden in the tree, black in the picture, and the Person's to fill", async () => {
    fresh()
    const calls = driver()
    const { tab } = await open(calls)
    const { tree } = await snapshot(calls, tab)
    expect(tree).not.toContain("hunter2secret")
    expect(tree).not.toContain("4111111111111111")
    expect(tree).toMatch(/textbox "Password"[^\n]*: ••••/)
    await expect(
      act(calls, tab, {
        action: "fill",
        ref: refOf(tree, 'textbox "Password"'),
        text: "x",
      })
    ).rejects.toMatchObject({ code: "forbidden" })
    const picture = (await calls.call("screenshot", { tab, by })) as Screenshot
    expect(picture).toMatchObject({
      tab,
      url: `${origin}/`,
      title: "Home",
      width: 1280,
      height: 800,
    })
    expect(picture.pictures).toHaveLength(1)
    expect(picture.pictures[0].mime).toBe("image/jpeg")
    shot = Buffer.from(picture.pictures[0].data, "base64")
    expect(shot.length).toBeLessThanOrEqual(1024 * 1024)
    // The picture, read back in a page: the field is black, the page
    // beside it red.
    const pixels = await open(calls, "/pixels")
    await calls.call("wait_for", { tab: pixels.tab, text: "field ", by })
    const said = /field (\d+),(\d+),(\d+) beside (\d+),(\d+),(\d+)/.exec(
      (await snapshot(calls, pixels.tab)).tree
    )!
    const [fr, fg, fb, br, bg, bb] = said.slice(1).map(Number)
    expect(Math.max(fr, fg, fb)).toBeLessThan(40)
    expect(br).toBeGreaterThan(150)
    expect(Math.max(bg, bb)).toBeLessThan(60)
  })

  test("a download lands in the folder, under a name no file there has", async () => {
    fresh()
    const calls = driver()
    const { tab } = await open(calls)
    const link = refOf((await snapshot(calls, tab)).tree, 'link "Download"')
    const { downloads } = profile()
    const first = await act(calls, tab, { action: "click", ref: link })
    expect(first.download).toBe(join(downloads, "report.txt"))
    const second = await act(calls, tab, { action: "click", ref: link })
    expect(second.download).toBe(join(downloads, "report (1).txt"))
    for (const path of [first.download!, second.download!])
      await until(() => readFileSync(path, "utf8") === "the report")
  })

  test("a page a click opens is a tab with the next id", async () => {
    fresh()
    const calls = driver()
    const { tab } = await open(calls)
    const clicked = await act(calls, tab, {
      action: "click",
      ref: refOf((await snapshot(calls, tab)).tree, 'link "Open popup"'),
    })
    expect(clicked.opened).toEqual([
      {
        id: tab + 1,
        url: `${origin}/popup`,
        title: expect.any(String),
        driven: false,
        lent: false,
      },
    ])
    expect((await snapshot(calls, tab + 1)).tree).toContain("A popup")
    expect(await calls.call("close", { tab: tab + 1 })).toBeNull()
    await expect(snapshot(calls, tab + 1)).rejects.toMatchObject({
      code: "not_found",
    })
  })

  test("it waits for a text, a ref and an address", async () => {
    fresh()
    const calls = driver()
    const { tab } = await open(calls)
    const later = (await calls.call("wait_for", {
      tab,
      text: "Later",
      by,
    })) as Shown
    expect(later).toMatchObject({ tab, url: `${origin}/`, dialog: null })
    const { tree } = await snapshot(calls, tab)
    const link = refOf(tree, 'link "Next"')
    await calls.call("wait_for", { tab, ref: link, by })
    const [, there] = await Promise.all([
      act(calls, tab, { action: "click", ref: link }),
      calls.call("wait_for", { tab, url: "/next", by }) as Promise<Shown>,
    ])
    expect(there.url).toBe(`${origin}/next`)
  })

  test("two profiles share nothing, and a profile is kept across the driver's restart", async () => {
    fresh()
    const one = profile("one")
    const two = profile("two")
    const calls = driver()
    await open(calls, "/cookie", one)
    const mine = await open(calls, "/whoami", one)
    expect((await snapshot(calls, mine.tab)).tree).toContain("cookie: seen=1")
    const theirs = await open(calls, "/whoami", two)
    expect((await snapshot(calls, theirs.tab)).tree).toContain("cookie: none")
    expect(running(one.profile).length).toBeGreaterThan(0)
    expect(running(two.profile).length).toBeGreaterThan(0)
    await calls.close()
    expect(running(one.profile)).toEqual([])
    const again = driver()
    const still = await open(again, "/whoami", one)
    expect((await snapshot(again, still.tab)).tree).toContain("cookie: seen=1")
  })

  test("a profile's Chromium quits a while after its last tab closed, and not before", async () => {
    fresh()
    const calls = driver({ idle: 1500 })
    const where = profile()
    const first = await open(calls, "/", where)
    const second = await open(calls, "/next", where)
    await calls.call("close", { tab: first.tab })
    await calls.call("close", { tab: second.tab })
    expect(await calls.call("tabs", { profile: where.profile })).toEqual([])
    // A tab opened meanwhile keeps it: the same Chromium goes on.
    const pids = running(where.profile)
    expect(pids.length).toBeGreaterThan(0)
    await sleep(700)
    const third = await open(calls, "/", where)
    await sleep(1200)
    expect(running(where.profile)).toEqual(pids)
    await calls.call("close", { tab: third.tab })
    await sleep(700)
    expect(running(where.profile)).toEqual(pids)
    await until(() => running(where.profile).length === 0)
    expect(await calls.call("tabs", { profile: where.profile })).toEqual([])
    // And it starts again for the next tab.
    const fourth = await open(calls, "/", where)
    expect(fourth).toMatchObject({ tab: third.tab + 1, title: "Home" })
  })

  test("its input closing ends it, with no Chromium left", async () => {
    fresh()
    const input = new PassThrough()
    const output = new PassThrough()
    const answers = createInterface({ input: output })[Symbol.asyncIterator]()
    const where = profile()
    const served = serve(
      input,
      output,
      browsers({ chromium: CHROMIUM!, sandbox: SANDBOX }, () => {}),
      () => {}
    )
    input.write(
      `${JSON.stringify({ id: 1, method: "open", params: { ...where, url: `${origin}/`, by } })}\n`
    )
    const { value } = await answers.next()
    expect(JSON.parse(value!)).toMatchObject({
      id: 1,
      ok: { tab: 1, title: "Home" },
    })
    expect(running(where.profile).length).toBeGreaterThan(0)
    input.end()
    await served
    expect(running(where.profile)).toEqual([])
  })

  // The program as the engine starts it: it has no way to start Chromium
  // without its sandbox, so this runs only where the system allows it.
  test.skipIf(!SANDBOX)(
    "the built program answers on its lines, and ends with its input",
    async () => {
      fresh()
      const built = join(import.meta.dirname, "../dist/browser-driver.mjs")
      execFileSync(process.execPath, [
        join(import.meta.dirname, "../build.mjs"),
      ])
      expect(existsSync(built)).toBe(true)
      const where = profile()
      const child = spawn(
        process.execPath,
        [built, "--chromium", CHROMIUM!, "--first-tab", "5"],
        {
          stdio: ["pipe", "pipe", "inherit"],
        }
      )
      const answers = createInterface({ input: child.stdout })[
        Symbol.asyncIterator
      ]()
      child.stdin.write(
        `${JSON.stringify({ id: 1, method: "open", params: { ...where, url: `${origin}/`, by } })}\n`
      )
      const { value } = await answers.next()
      expect(JSON.parse(value!)).toMatchObject({
        id: 1,
        ok: { tab: 5, title: "Home" },
      })
      child.stdin.end()
      const code = await new Promise((done) => child.once("exit", done))
      expect(code).toBe(0)
      expect(running(where.profile)).toEqual([])
      expect(basename(built)).toBe("browser-driver.mjs")
    }
  )
})
