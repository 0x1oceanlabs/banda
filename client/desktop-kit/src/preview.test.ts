import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it } from "vitest"
import { FileLinks } from "./files"
import { PREVIEW_CSP, PREVIEW_HOST } from "./preview"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "banda-preview-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** What a frame's navigation sends to Electron's handler, which hears no
 * `Sec-Fetch-*`. */
const FRAME = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "upgrade-insecure-requests": "1",
}

/** What `links` answers at `url`, asked with `headers`. */
const asked = (links: FileLinks, url: string, headers: HeadersInit) =>
  links.serve(new Request(url, { headers }), 1)

it("serves a page into a frame, sandboxed, with nothing from the network", async () => {
  const links = new FileLinks(undefined, PREVIEW_HOST)
  const page = join(dir, "index.html")
  await writeFile(page, "<p>hi</p><script>parent.document</script>")
  const url = await links.issue(page, 0)
  expect(url).toMatch(/^app:\/\/preview\//)
  const shown = await asked(links, url!, FRAME)
  expect(shown.status).toBe(200)
  expect(shown.headers.get("content-type")).toBe("text/html; charset=utf-8")
  expect(shown.headers.get("x-content-type-options")).toBe("nosniff")
  expect(shown.headers.get("cross-origin-resource-policy")).toBe("same-origin")
  expect(shown.headers.get("access-control-allow-origin")).toBeNull()
  expect(await shown.text()).toContain("<p>hi</p>")

  const csp = shown.headers.get("content-security-policy")
  expect(csp).toBe(PREVIEW_CSP)
  const rules = new Map(
    csp!.split("; ").map((rule) => {
      const [name, ...values] = rule.split(" ")
      return [name, values.join(" ")] as const
    })
  )
  expect(rules.get("default-src")).toBe("'none'")
  expect(rules.get("img-src")).toBe("app://files data:")
  expect(rules.get("style-src")).toBe("'unsafe-inline'")
  // Scripts run, but only in the sandbox: never on an origin of its own.
  expect(rules.get("sandbox")).toBe("allow-scripts")
  expect(csp).not.toContain("allow-same-origin")
  expect(rules.has("connect-src")).toBe(false)
})

it("never serves the app's own page, its fetch or a picture, nor a window's page: a frame alone gets it", async () => {
  const links = new FileLinks(undefined, PREVIEW_HOST)
  const page = join(dir, "index.html")
  await writeFile(page, "<p>hi</p>")
  const url = (await links.issue(page, 0))!
  const refused: Record<string, string>[] = [
    // Banda's page fetching it, or a picture of it.
    { accept: "*/*", origin: "app://banda" },
    { ...FRAME, origin: "app://banda" },
    { accept: "image/*" },
    // Where Chromium says what for: a page's fetch, a window's page.
    { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" },
    { ...FRAME, "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    // Who says nothing.
    {},
  ]
  for (const headers of refused)
    expect((await asked(links, url, headers)).status).toBe(404)
  expect((await asked(links, url, FRAME)).status).toBe(200)
  const framed = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" }
  expect((await asked(links, url, framed)).status).toBe(200)
})

it("serves only pages: an SVG document too, never another kind, nor a page by a link to another kind", async () => {
  const links = new FileLinks(undefined, PREVIEW_HOST)
  await writeFile(
    join(dir, "logo.svg"),
    "<svg xmlns='http://www.w3.org/2000/svg'/>"
  )
  await writeFile(join(dir, "notes.txt"), "secret")
  await symlink(join(dir, "notes.txt"), join(dir, "notes.html"))
  const svg = await links.issue(join(dir, "logo.svg"), 0)
  expect((await asked(links, svg!, FRAME)).headers.get("content-type")).toBe(
    "image/svg+xml"
  )
  expect(await links.issue(join(dir, "notes.txt"), 0)).toBeNull()
  expect(await links.issue(join(dir, "notes.html"), 0)).toBeNull()
})

it("a link of one host is not the other's: each signs with its own secret", async () => {
  const pages = new FileLinks(undefined, PREVIEW_HOST)
  const bytes = new FileLinks()
  const page = join(dir, "index.html")
  await writeFile(page, "<p>hi</p>")
  const url = (await pages.issue(page, 0))!
  const asBytes = url.replace("app://preview/", "app://files/")
  expect((await bytes.serve(new Request(asBytes), 1)).status).toBe(404)
  const byteUrl = (await bytes.issue(page, 0))!
  const asPage = byteUrl.replace("app://files/", "app://preview/")
  expect((await asked(pages, asPage, FRAME)).status).toBe(404)
  // The byte host serves a page as its text, which runs nothing.
  const text = await bytes.serve(new Request(byteUrl), 1)
  expect(text.headers.get("content-type")).toBe("text/plain; charset=utf-8")
})
