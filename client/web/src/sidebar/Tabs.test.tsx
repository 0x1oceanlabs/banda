import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import type { Tab, TabCount } from "./inbox"
import { tabKey, tabName, Tabs } from "./Tabs"

const counts = (
  inbox: TabCount,
  rest: Partial<Record<Exclude<Tab, "inbox">, number>> = {}
): Record<Tab, TabCount> => ({
  inbox,
  working: { count: rest.working ?? 0, calls: false },
  later: { count: rest.later ?? 0, calls: false },
  archive: { count: rest.archive ?? 0, calls: false },
})

/** The tabs drawn, as plain text a test can read. */
const drawn = (tabs: Record<Tab, TabCount>, tab: Tab = "inbox") =>
  renderToStaticMarkup(<Tabs tabs={tabs} tab={tab} />)

test("a tab's count shows only when it holds any; the Archive's only in its tooltip and its name", () => {
  const html = drawn(
    counts({ count: 4, calls: false }, { later: 2, archive: 31 })
  )
  expect(html).toContain(">Inbox</span><span")
  expect(html).toContain(">4</span>")
  // Working holds none, so its name stands alone.
  expect(html).toMatch(
    /aria-label="Working"[^>]*><span[^>]*>Working<\/span><\/button>/
  )
  expect(html).toContain('title="Archive · 31 (4)"')
  expect(html).toContain('aria-label="Archive, 31"')
  expect(html).not.toContain(">31<")
  expect(html).toContain('aria-label="Inbox, 4"')
})

test("the Inbox's count is in the attention colour only while it is the Person's turn", () => {
  expect(drawn(counts({ count: 3, calls: true }))).toContain("text-attention")
  expect(drawn(counts({ count: 3, calls: false }))).not.toContain(
    "text-attention"
  )
})

test("a narrow sidebar cuts a tab's words short, never its count nor the Archive", () => {
  const html = drawn(counts({ count: 4, calls: true }, { working: 9 }))
  expect(html).toMatch(/id="sb-tab-inbox"[^>]*class="[^"]*\bmin-w-0\b/)
  expect(html).toContain('<span class="truncate">Inbox</span>')
  expect(html).toMatch(/class="[^"]*\bshrink-0\b[^"]*">4<\/span>/)
  expect(html).toMatch(/id="sb-tab-archive"[^>]*class="[^"]*\bshrink-0\b/)
})

test("the tab in view is selected and the one Tab stop", () => {
  const html = drawn(counts({ count: 0, calls: false }), "later")
  expect(html).toMatch(
    /id="sb-tab-later"[^>]*aria-selected="true"[^>]*tabindex="0"/
  )
  expect(html).toMatch(
    /id="sb-tab-inbox"[^>]*aria-selected="false"[^>]*tabindex="-1"/
  )
  expect(html.match(/role="tab"/g)).toHaveLength(4)
})

test("a tab's name aloud has its count when it holds any", () => {
  expect(tabName("inbox", { count: 4, calls: true })).toBe("Inbox, 4")
  expect(tabName("working", { count: 0, calls: false })).toBe("Working")
})

const press = (
  code: string,
  more: Partial<Parameters<typeof tabKey>[0]> = {}
) =>
  tabKey({
    code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    target: null,
    ...more,
  })

test("1 to 4 show the tabs in their order; a mod, a press held down or a field shows none", () => {
  expect(
    ["Digit1", "Digit2", "Digit3", "Digit4"].map((code) => press(code))
  ).toEqual(["inbox", "working", "later", "archive"])
  expect(press("Digit5")).toBeUndefined()
  expect(press("KeyA")).toBeUndefined()
  expect(press("Digit1", { altKey: true })).toBeUndefined()
  expect(press("Digit2", { ctrlKey: true })).toBeUndefined()
  expect(press("Digit3", { shiftKey: true })).toBeUndefined()
  expect(press("Digit1", { repeat: true })).toBeUndefined()
  expect(press("Digit1", { isComposing: true })).toBeUndefined()
  const field = { closest: (what: string) => (what ? {} : null) }
  expect(
    press("Digit1", { target: field as unknown as EventTarget })
  ).toBeUndefined()
  const card = { closest: () => null }
  expect(press("Digit4", { target: card as unknown as EventTarget })).toBe(
    "archive"
  )
})
