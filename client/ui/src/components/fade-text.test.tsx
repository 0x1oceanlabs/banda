// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, test, vi } from "vitest"
import { CutTips, FadeText, isCut, TIP_REST } from "./fade-text"

const css = readFileSync(
  join(import.meta.dirname, "../styles/globals.css"),
  "utf8"
)

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

test('the text is its own scroll box, cut with no "…", and outside a CutTips no tooltip\'s trigger', () => {
  const html = renderToStaticMarkup(
    <FadeText tip="A long title" className="text-sm">
      A long title
    </FadeText>
  )
  expect(html).toBe(
    '<span data-slot="fade-text" class="min-w-0 overflow-hidden whitespace-nowrap text-sm">A long title</span>'
  )
})

test("the mask is only on overflow: in keyframes its own scroll timeline plays, which is live only while it holds more than it shows; no rule masks it otherwise, and no motion setting stops it", () => {
  const rule = /\[data-slot="fade-text"\] \{([^}]*)\}/.exec(css)?.[1] ?? ""
  expect(rule).toContain("animation: fade-text 1ms both;")
  expect(rule).toContain("animation-timeline: scroll(self inline);")
  expect(rule).not.toMatch(/mask/)
  const keyframes = /@keyframes fade-text \{([\s\S]*?)\n\}/.exec(css)?.[1]
  expect(keyframes).toMatch(/from,\s*to \{\s*mask-image: linear-gradient\(/)
  // The mask is said there alone.
  expect(css.match(/1\.75rem\),\s*transparent/g)).toHaveLength(1)
  // The sidebar's still rules leave it be: nothing moves in it.
  for (const still of css.matchAll(
    /(?:html\[data-still\] )?:is\(aside\[data-sidebar\], \[data-sonner-toaster\]\)\s*\*([^,{]*)/g
  ))
    expect(still[1]).toContain(':not([data-slot="fade-text"])')
})

/** `element` as wide as `client`, holding `scroll`. */
function holding(element: Element, scroll: number, client: number) {
  Object.defineProperty(element, "scrollWidth", { value: scroll })
  Object.defineProperty(element, "clientWidth", { value: client })
}

test("a text is cut when it holds more than it shows", () => {
  const span = document.createElement("span")
  holding(span, 120, 120)
  expect(isCut(span)).toBe(false)
  const long = document.createElement("span")
  holding(long, 240, 120)
  expect(isCut(long)).toBe(true)
})

test("the pointer at rest on cut text shows it whole after 500 ms; on text that fits, nothing", async () => {
  const flags = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  flags.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  const element = document.body.appendChild(document.createElement("aside"))
  const root = createRoot(element)
  await act(async () =>
    root.render(
      <CutTips edge="aside">
        <FadeText tip="Bench the window tests on arc">
          Bench the window tests on arc
        </FadeText>
        <FadeText tip="Fits">Fits</FadeText>
      </CutTips>
    )
  )
  const [cut, fits] = [...element.querySelectorAll("[data-slot=fade-text]")]
  holding(cut!, 240, 120)
  holding(fits!, 40, 40)
  const tip = () => document.querySelector("[data-slot=cut-tip]")
  const rest = async (on: Element) => {
    await act(async () => {
      on.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
      on.dispatchEvent(new MouseEvent("mouseenter"))
      on.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))
    })
  }
  const leave = async (on: Element) => {
    await act(async () => {
      on.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }))
      on.dispatchEvent(new MouseEvent("mouseleave"))
      await vi.advanceTimersByTimeAsync(1000)
    })
  }

  await rest(fits!)
  await act(() => vi.advanceTimersByTimeAsync(TIP_REST + 100))
  expect(tip()).toBeNull()
  await leave(fits!)

  await rest(cut!)
  await act(() => vi.advanceTimersByTimeAsync(TIP_REST - 100))
  expect(tip()).toBeNull()
  await act(() => vi.advanceTimersByTimeAsync(200))
  expect(tip()?.textContent).toBe("Bench the window tests on arc")
  await act(async () => root.unmount())
})
