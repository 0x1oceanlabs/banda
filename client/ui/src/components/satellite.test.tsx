// @vitest-environment happy-dom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, test, vi } from "vitest"
import { BLEND_MS, type SatelliteState } from "../lib/satellite"
import { Satellite } from "./satellite"

afterEach(() => {
  vi.useRealTimers()
  document.documentElement.removeAttribute("data-still")
})

test("a satellite is an image named by its state's word, drawn still at first, in its state's colour", () => {
  const html = renderToStaticMarkup(<Satellite state="asks" />)
  expect(html).toMatch(
    /^<span role="img" aria-label="Asks" data-slot="satellite" data-sat="asks"/
  )
  expect(html).toContain("width:10px;height:10px;color:var(--attention)")
  // A first draw has no news: one shape, and no motion.
  expect(html.match(/<svg/g)).toHaveLength(1)
  expect(html).not.toContain("data-sat-motion")
  expect(html).toContain('data-shape="triangle"')
  expect(html).toContain("<polygon")
})

test("a label names it in place of its state's word, at the size asked", () => {
  const html = renderToStaticMarkup(
    <Satellite state="working" size={12} label="Explore, working" />
  )
  expect(html).toContain('aria-label="Explore, working"')
  expect(html).toContain('viewBox="0 0 12 12"')
  expect(html).toContain("color:var(--sat-working)")
})

test("a change of look blends within its shape and leaps to another, the shape it leaves fading out; [motion] off draws it still", async () => {
  const flags = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  flags.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  const element = document.createElement("div")
  const root = createRoot(element)
  const draw = (state: SatelliteState) =>
    act(async () => root.render(<Satellite state={state} />))
  const motions = () =>
    [...element.querySelectorAll("svg")].map((svg) => [
      svg.getAttribute("data-shape"),
      svg.getAttribute("data-sat-motion"),
    ])
  await draw("working")
  expect(motions()).toEqual([["circle", null]])
  // Queued is a circle too: it blends.
  await draw("queued")
  expect(motions()).toEqual([
    ["circle", "out"],
    ["circle", "blend"],
  ])
  // Asks is a triangle: it leaps.
  await draw("asks")
  expect(motions()).toEqual([
    ["circle", "out"],
    ["triangle", "leap"],
  ])
  // The shape it left goes once it has faded.
  await act(async () => vi.advanceTimersByTime(BLEND_MS + 10))
  expect(motions()).toEqual([["triangle", "leap"]])
  // Still, it changes at once, with nothing fading.
  document.documentElement.setAttribute("data-still", "")
  await draw("done")
  expect(motions()).toEqual([["square", null]])
  await act(async () => root.unmount())
  flags.IS_REACT_ACT_ENVIRONMENT = false
})
