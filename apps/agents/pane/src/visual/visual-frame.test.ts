import type { Look } from "@banda/contract/look"
import { expect, test } from "vitest"
import {
  heard,
  heightAt,
  LOOK_KEY,
  lookedAt,
  lookMessage,
  visualAddress,
  visualAddressOn,
  visualLook,
  visualLookOf,
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
  "--control-radius": "0.625rem",
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
  expect(look.variables["--radius"]).toBe("0.625rem")
  expect(look.variables["--destructive-surface"]).toBe(
    "color-mix(in oklab, #f7768e 16%, transparent)"
  )
  // A token the look leaves out is left out.
  expect("--card" in look.variables).toBe(false)
  expect(visualLook(read, false).theme).toBe("light")
})

test("another machine's Visual is addressed by that machine and its engine's token", () => {
  expect(visualAddressOn("arc", "t0k3n")).toBe("app://visuals/of/arc/t0k3n")
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

test("a page passes the window Esc and Ctrl or ⌘ with + − 0, and no other key", () => {
  const key = (params: object) => heard({ method: "banda/key", params })
  const none = {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
  }
  expect(key({ code: "Escape" })).toEqual({
    kind: "key",
    key: { code: "Escape", key: "Escape", ...none },
  })
  expect(key({ code: "Equal", metaKey: true, shiftKey: true })).toEqual({
    kind: "key",
    key: { code: "Equal", key: "+", ...none, metaKey: true, shiftKey: true },
  })
  expect(key({ code: "Digit0", ctrlKey: true })?.kind).toBe("key")
  // Not the window's other keys, nor these held otherwise.
  expect(key({ code: "KeyD", altKey: true })).toBeNull()
  expect(key({ code: "Equal" })).toBeNull()
  expect(key({ code: "Escape", ctrlKey: true })).toBeNull()
  expect(key({ code: "Minus", ctrlKey: "yes" })).toBeNull()
})

test("main's look for a page comes from the look's scheme asked, its vars and its fonts", () => {
  const look = {
    schemes: {
      light: { "--background": "white", "--added": "green" },
      dark: { "--background": "black" },
    },
    vars: { "--control-radius": "4px", "--font-family-sans": "Inter" },
    desk: { glass: false },
  } as unknown as Look
  const dark = visualLookOf(look, true)
  expect(dark.variables["--background"]).toBe("black")
  expect(dark.variables["--radius"]).toBe("4px")
  expect(dark.variables["--font-sans"]).toBe("Inter")
  expect(visualLookOf(look, false).variables["--success"]).toBe("green")
  // One scheme serves both; no look gives none.
  const one = { ...look, schemes: { light: { "--background": "white" } } }
  expect(visualLookOf(one as Look, true)).toMatchObject({
    theme: "light",
    variables: { "--background": "white" },
  })
  expect(visualLookOf(null, true)).toEqual({ theme: "dark", variables: {} })
  // Over glass, the glass scheme, as the window's page has it.
  const glass = {
    ...look,
    desk: { glass: true },
    schemes: { ...look.schemes, dark_glass: { "--muted": "rgb(0 0 0 / 0.1)" } },
  } as unknown as Look
  expect(visualLookOf(glass, true).variables["--muted"]).toBe(
    "rgb(0 0 0 / 0.1)"
  )
})

test("a frame is as tall as the window found its page at the widest width that fits", () => {
  const fits = [
    { width: 320, height: 700 },
    { width: 423, height: 500 },
    { width: 732, height: 300 },
  ]
  expect(heightAt(fits, 700, 120)).toBe(500)
  expect(heightAt(fits, 732, 120)).toBe(300)
  expect(heightAt(fits, 2000, 120)).toBe(300)
  // Narrower than any, the narrowest; with none, the Agent's.
  expect(heightAt(fits, 200, 120)).toBe(700)
  expect(heightAt([], 700, 120)).toBe(120)
  expect(heightAt([{ width: 320, height: 5 }], 700, 120)).toBe(80)
})
