import { expect, test } from "vitest"
import {
  heard,
  LOOK_KEY,
  lookedAt,
  lookMessage,
  visualAddress,
  visualLook,
} from "./visual-frame"

const TOKENS: Record<string, string> = {
  "--background": " oklch(0.2 0 0)",
  "--foreground": "oklch(0.9 0 0)",
  "--primary": "#7aa2f7",
  "--primary-foreground": "#1a1b26",
  "--added": "#9ece6a",
  "--attention": "#ff9e64",
  "--destructive": "#f7768e",
  "--accent": "#bb9af7",
  "--chart-1": "#7aa2f7",
  "--chart-2": "#9ece6a",
  "--radius": "0.625rem",
}
const read = (token: string) => TOKENS[token] ?? ""

test("a Visual wears T3 Code's names in the look's colours", () => {
  const look = visualLook(read, true)
  expect(look.theme).toBe("dark")
  expect(look.variables["--background"]).toBe("oklch(0.2 0 0)")
  expect(look.variables["--success"]).toBe("#9ece6a")
  expect(look.variables["--warning"]).toBe("#ff9e64")
  expect(look.variables["--info"]).toBe("#9ece6a")
  expect(look.variables["--chart-6"]).toBe("#7aa2f7")
  expect(look.variables["--destructive-surface"]).toBe(
    "color-mix(in oklab, #f7768e 16%, transparent)"
  )
  // A token the look leaves out is left out.
  expect("--card" in look.variables).toBe(false)
  expect(visualLook(read, false).theme).toBe("light")
})

test("the page's address carries its first look", () => {
  const look = visualLook(read, true)
  const address = lookedAt(visualAddress("s1", "v1"), look)
  expect(address.startsWith(`app://visuals/s1/v1#${LOOK_KEY}=`)).toBe(true)
  const fragment = decodeURIComponent(address.split("=").slice(1).join("="))
  expect(JSON.parse(fragment)).toEqual({
    theme: "dark",
    styles: { variables: look.variables },
  })
  expect(lookMessage(look)).toEqual({
    jsonrpc: "2.0",
    method: "ui/notifications/host-context-changed",
    params: { theme: "dark", styles: { variables: look.variables } },
  })
})

test("a page's height is taken within bounds, and only web links", () => {
  const size = (height: unknown) =>
    heard({ method: "ui/notifications/size-changed", params: { height } })
  expect(size(321.2)).toEqual({ kind: "size", height: 322 })
  expect(size(10)).toEqual({ kind: "size", height: 80 })
  expect(size(1e9)).toEqual({ kind: "size", height: 20_000 })
  expect(size(Number.NaN)).toBeNull()
  expect(size("300")).toBeNull()
  const link = (url: unknown) =>
    heard({ method: "ui/open-link", params: { url } })
  expect(link("https://example.com/a")).toEqual({
    kind: "link",
    url: "https://example.com/a",
  })
  expect(link("file:///etc/passwd")).toBeNull()
  expect(link("javascript:alert(1)")).toBeNull()
  expect(heard("hi")).toBeNull()
  expect(heard({ method: "tools/call", params: {} })).toBeNull()
})
