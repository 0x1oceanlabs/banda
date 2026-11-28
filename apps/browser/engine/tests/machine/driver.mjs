// A driver for the engine's tests: it speaks the driver's lines
// (apps/browser/driver/src/lines.ts) and keeps its tabs in a Map, with no
// Chromium. Each line it hears, and how it was started, it writes to
// heard.jsonl beside itself, for the test to read.
import { appendFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

const heard = join(dirname(fileURLToPath(import.meta.url)), "heard.jsonl")
const note = (line) => appendFileSync(heard, `${JSON.stringify(line)}\n`)

const started = process.argv.slice(2)
let next = Number(started[started.indexOf("--first-tab") + 1])
note({ started, electron: process.env.ELECTRON_RUN_AS_NODE ?? null })

/** Each tab by its id: where it is, and its profile. */
const tabs = new Map()

const shown = (id, more = {}) => ({
  tab: id,
  url: tabs.get(id).url,
  title: "Page",
  loading: false,
  moved: false,
  opened: [],
  dialog: null,
  download: null,
  touched: false,
  ...more,
})

const say = (line) => process.stdout.write(`${JSON.stringify(line)}\n`)

createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line)
  note({ method, params })
  const ok = (ok) => say({ id, ok })
  const none = () =>
    say({
      id,
      refused: {
        code: "not_found",
        message: `There is no tab ${params.tab}: browser_tabs lists them.`,
      },
    })
  if (method === "open") {
    const tab = next++
    tabs.set(tab, {
      url: params.url ?? "about:blank",
      profile: params.profile,
    })
    return ok(shown(tab))
  }
  if (method === "tabs")
    return ok(
      [...tabs]
        .filter(([, tab]) => tab.profile === params.profile)
        .map(([id, tab]) => ({ id, url: tab.url, title: "Page" }))
    )
  const tab = tabs.get(params.tab)
  if (!tab) return none()
  switch (method) {
    case "where":
      return ok({ url: tab.url, profile: tab.profile })
    case "navigate":
      // An address that never answers: nor does the driver.
      if (params.to.includes("hang")) return
      tab.url = params.to
      return ok(shown(params.tab))
    case "snapshot":
      // A page that takes the driver down with it.
      if (tab.url.includes("/die")) process.exit(1)
      return ok({
        url: tab.url,
        title: "Page",
        tree: '- button "Go" [ref=e2]',
        errors: [],
        dialog: null,
      })
    case "screenshot":
      return ok({
        tab: params.tab,
        url: tab.url,
        title: "Page",
        width: 2,
        height: 1,
        pictures: [{ mime: "image/jpeg", data: "/9j/" }],
      })
    case "act": {
      if (params.key === "Die") process.exit(1)
      // A key that closes its tab under the call.
      if (params.key === "Gone") {
        tabs.delete(params.tab)
        return none()
      }
      // A link that opens a tab of its own.
      if (params.ref === "popup") {
        const opened = next++
        tabs.set(opened, { url: "https://popup.test/", profile: tab.profile })
        const seen = { id: opened, url: "https://popup.test/", title: "" }
        return ok(
          shown(params.tab, {
            opened: [{ ...seen, driven: false, lent: false }],
          })
        )
      }
      return ok(shown(params.tab))
    }
    case "wait_for":
      return ok(shown(params.tab))
    default:
      return say({
        id,
        refused: { code: "invalid", message: `No method "${method}".` },
      })
  }
})
