import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { ProjectId } from "@banda/contract"
import type { Listed } from "@banda/ui/pane"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"
import { newStores, StoresContext, takeLists } from "../calls/stores"
import { Title } from "./Title"

// The title field's store reads the page as it is, so has no state for a
// server's drawing: here no field is open, and no title is thought of.
vi.mock("@banda/ui/lib/naming", async (actual) => ({
  ...(await actual<typeof import("@banda/ui/lib/naming")>()),
  useNaming: () => undefined,
  useThinking: () => false,
}))

const p = "p" as ProjectId
const q = "q" as ProjectId

const thread = (id: string, more: Partial<Listed> = {}): Listed => ({
  id,
  title: "Listed title",
  mark: "idle",
  changed: 0,
  agent: `agent ${id}`,
  pane: { kind: "agents.thread", args: { thread: id } },
  ...more,
})

/** The Title of `thing` in `p`, as the Pane says it, under the Window's
 * stores holding `lists`. */
function drawn(thing: string, lists: Parameters<typeof takeLists>[1] = {}) {
  const stores = newStores()
  takeLists(stores, lists)
  return renderToStaticMarkup(
    <StoresContext value={stores}>
      <Title project={p} thing={thing} title="Hello" focused />
    </StoresContext>
  )
}

/** The plain title a Pane's frame draws in its header, where its Pane
 * shows no Item. */
const PLAIN =
  "min-w-0 truncate font-medium text-muted-foreground group-data-[selected=true]/tile:text-foreground"

test("a title whose Item no App lists, or whose App cannot rename it, is the plain title a Pane's frame draws", () => {
  const plain = `<h2 class="${PLAIN}">Hello</h2>`
  // None listed: as when the Item went before the frame heard it.
  expect(drawn("t1")).toBe(plain)
  // The same id, in another Project.
  expect(drawn("t1", { [q]: [thread("t1")] })).toBe(plain)
  // Listed by an App with no item action that renames it.
  expect(
    drawn("t1", {
      [p]: [thread("t1", { pane: { kind: "terminal.terminal", args: {} } })],
    })
  ).toBe(plain)
  // The frame's own is the same.
  const frame = readFileSync(
    join(import.meta.dirname, "../tiling/PaneFrame.tsx"),
    "utf8"
  )
  expect(frame).toContain(`<h2 className="${PLAIN}">`)
})

test("a title finds its Thread itself: its words, as the Pane says them, open the Thread menu", () => {
  // Beside it, Items their App cannot rename: a title that found one of
  // them would be plain.
  const terminal = (id: string) =>
    thread(id, { pane: { kind: "terminal.terminal", args: {} } })
  const html = drawn("t1", {
    [p]: [terminal("t0"), thread("t1"), terminal("t2")],
  })
  expect(html).toContain('aria-haspopup="menu"')
  expect(html).not.toContain(`<h2 class="${PLAIN}">`)
  // The words are the Pane's, not the Listed's.
  expect(html).toContain(">Hello</span>")
  expect(html).not.toContain("Listed title")
})
