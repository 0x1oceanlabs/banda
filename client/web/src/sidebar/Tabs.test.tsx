import { renderToStaticMarkup } from "react-dom/server"
import { DEFAULT_KEYS } from "@banda/contract/look"
import { KeysInForce } from "@banda/ui/hooks/use-key-of"
import { expect, test } from "vitest"
import { type Inbox, TABS, type Tab, type TabCount } from "./inbox"
import { tabName, Tabs } from "./Tabs"

const counts = (
  inbox: TabCount,
  rest: Partial<Record<Exclude<Tab, "inbox">, number>> = {}
): Inbox["tabs"] => ({
  inbox,
  working: { count: rest.working ?? 0, calls: false },
  later: { count: rest.later ?? 0, calls: false },
  archive: { count: rest.archive ?? 0, calls: false },
  ...(rest.all === undefined ? {} : { all: { count: rest.all, calls: false } }),
})

/** The keys in force: the sidebar's, `1`–`4` for the tabs, `0` for All. */
const keys = {
  mod: DEFAULT_KEYS.mod,
  byAction: new Map([
    ...TABS.map(
      (tab, at) => [`sidebar.tab-${tab}`, { code: `Digit${at + 1}` }] as const
    ),
    ["sidebar.tab-all", { code: "Digit0" }] as const,
  ]),
  byScope: new Map(),
}

/** The tabs drawn, as plain text a test can read. */
const drawn = (tabs: Inbox["tabs"], tab: Tab = "inbox") =>
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

test("while a search runs, All comes first with its key, every tab counts what it found, the Archive beside its icon, and one that found nothing goes unless shown (ADR 0098, decision 17)", () => {
  const html = drawn(
    counts({ count: 1, calls: false }, { all: 4, working: 1, archive: 2 }),
    "all"
  )
  // Later found nothing.
  expect(html.match(/role="tab"/g)).toHaveLength(4)
  expect(html).not.toContain("sb-tab-later")
  expect(
    drawn(
      counts({ count: 0, calls: false }, { all: 4, archive: 4 }),
      "later"
    ).match(/id="sb-tab-\w+"/g)
  ).toEqual(['id="sb-tab-all"', 'id="sb-tab-later"', 'id="sb-tab-archive"'])
  expect(html.indexOf('id="sb-tab-all"')).toBeLessThan(
    html.indexOf('id="sb-tab-inbox"')
  )
  expect(html).toMatch(
    /id="sb-tab-all"[^>]*aria-selected="true"[^>]*aria-label="All, 4"[^>]*tabindex="0"[^>]*title="All \(0\)"/
  )
  expect(html).toContain(">2</span>")
  expect(html).toContain('aria-label="Archive, 2"')
  // A tab but All and the one shown says its count alone, its word in its
  // name and tooltip, so five fit.
  expect(html).toMatch(
    /id="sb-tab-working"[^>]*aria-label="Working, 1"[^>]*title="Working \(2\)"[^>]*><span[^>]*>1<\/span><\/button>/
  )
  expect(html).toContain('<span class="truncate">All</span>')
  expect(html).not.toContain('<span class="truncate">Working</span>')
  expect(
    drawn(counts({ count: 1, calls: false }, { all: 2, working: 1 }), "working")
  ).toContain('<span class="truncate">Working</span>')
  // No search, no All.
  expect(drawn(counts({ count: 1, calls: false }))).not.toContain("sb-tab-all")
})
