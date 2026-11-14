import { renderToStaticMarkup } from "react-dom/server"
import { DEFAULT_KEYS } from "@banda/contract/look"
import { KeysInForce } from "@banda/ui/hooks/use-key-of"
import { expect, test } from "vitest"
import { TABS, type Tab, type TabCount } from "../model/inbox"
import { tabName, Tabs } from "./Tabs"

const counts = (
  inbox: TabCount,
  rest: Partial<Record<Exclude<Tab, "inbox">, number>> = {}
): Record<Tab, TabCount> => ({
  inbox,
  working: { count: rest.working ?? 0, calls: false },
  later: { count: rest.later ?? 0, calls: false },
  archive: { count: rest.archive ?? 0, calls: false },
})

/** The keys in force: the sidebar's, `1`–`4` for the tabs. */
const keys = {
  mod: DEFAULT_KEYS.mod,
  byAction: new Map(
    TABS.map((tab, at) => [`sidebar.tab-${tab}`, { code: `Digit${at + 1}` }])
  ),
  byScope: new Map(),
}

/** The tabs drawn, as plain text a test can read. */
const drawn = (tabs: Record<Tab, TabCount>, tab: Tab = "inbox") =>
  renderToStaticMarkup(
    <KeysInForce value={keys}>
      <Tabs tabs={tabs} tab={tab} />
    </KeysInForce>
  )

test("a tab's count shows only when it holds any; the Archive's only in its tooltip and its name, with its key in force", () => {
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
