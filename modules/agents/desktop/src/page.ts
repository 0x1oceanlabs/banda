/**
 * A Visual's page as the window serves it (ADR 0037, decisions 4 and 5):
 * the Agent's HTML with Banda's base sheet and a small script put first in
 * its head, so the page can override both. The script gives the page its
 * first look from the address's fragment, takes the look again when the
 * Thread posts it, says the page's height, and hands web links to the
 * window. Nothing of the Agent's page is taken out.
 */
import { LOOK_KEY, SAID } from "@banda/agents-pane/visual"

/** Banda's sheet under the page's: no ground of its own, so the page sits
 * on the Thread; the look's text and font; an 8px gutter for focus rings
 * and shadows; no scrollbars, as the frame fits the page. */
const BASE = [
  "html{box-sizing:border-box;padding:8px;background:transparent;",
  "color:var(--foreground);font-family:var(--font-sans),system-ui,sans-serif;",
  "font-size:14px;line-height:1.5;scrollbar-width:none}",
  "html::-webkit-scrollbar{display:none}",
  "*,*::before,*::after{box-sizing:inherit}",
  "body{margin:0}",
].join("")

/** The page's own height, as a script reads it with `root` its root:
 * past the frame, what scrolls; within it, what it lays out, so it can
 * shrink too. The check reads it as the frame does. */
export const HEIGHT = `Math.ceil(root.scrollHeight > root.clientHeight
  ? root.scrollHeight
  : root.getBoundingClientRect().height)`

/** The page's side of the frame, as visual-frame.ts says the words. */
const BRIDGE = `(() => {
  const root = document.documentElement
  const NAME = /^--[a-z0-9-]+$/
  const wear = (look) => {
    if (!look || typeof look !== "object") return
    const variables = (look.styles && look.styles.variables) || {}
    for (const [name, value] of Object.entries(variables)) {
      if (NAME.test(name) && typeof value === "string")
        root.style.setProperty(name, value.replace(/[;{}<>]/g, ""))
    }
    if (look.theme === "dark" || look.theme === "light") {
      root.style.colorScheme = look.theme
      root.dataset.theme = look.theme
    }
  }
  const first = new RegExp("[#&]${LOOK_KEY}=([^&]*)").exec(location.hash)
  if (first) {
    try { wear(JSON.parse(decodeURIComponent(first[1]))) } catch {}
    history.replaceState(null, "", location.pathname + location.search)
  }
  const say = (method, params) =>
    parent.postMessage({ jsonrpc: "2.0", method, params }, "*")
  addEventListener("message", (event) => {
    const said = event.data
    if (event.source === parent && said && said.method === "${SAID.look}")
      wear(said.params)
  })
  let told = 0
  const size = () => {
    const height = ${HEIGHT}
    if (height === told) return
    told = height
    say("${SAID.size}", { height })
  }
  new ResizeObserver(size).observe(root)
  addEventListener("load", size)
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element && event.target.closest("a[href]")
    if (!link) return
    const url = new URL(link.href, location.href)
    if (url.protocol !== "http:" && url.protocol !== "https:") return
    event.preventDefault()
    say("${SAID.link}", { url: url.href })
  }, true)
})()`

const PUT = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style id="banda-base">${BASE}</style><script>${BRIDGE}</script>`

/** Where the page's head opens, or else its root, or else its doctype. */
const HEAD = /<head(?:\s[^>]*)?>/i
const ROOT = /<html(?:\s[^>]*)?>/i
const DOCTYPE = /^\s*<!doctype[^>]*>/i

/** The Agent's page with Banda's sheet and script first in it. */
export function dressed(html: string): string {
  for (const opening of [HEAD, ROOT, DOCTYPE]) {
    const found = opening.exec(html)
    if (found) {
      const at = found.index + found[0].length
      return `${html.slice(0, at)}${PUT}${html.slice(at)}`
    }
  }
  return `${PUT}${html}`
}
