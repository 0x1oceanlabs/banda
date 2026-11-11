// @vitest-environment happy-dom
import type { ProjectId, ProjectSummary } from "@banda/contract"
import { DEFAULT_KEYS } from "@banda/contract/look"
import { KeysInForce } from "@banda/ui/hooks/use-key-of"
import type { Listed } from "@banda/ui/pane"
import type { Stand } from "@banda/ui/status"
import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import type { Row } from "./rows"
import { BulkBar } from "./BulkBar"
import { Bulk } from "./PickList"

const PROJECT = { id: "p1" as ProjectId, name: "Banda" } as ProjectSummary

/** A card of the Thread `id` where it stands, `stand`. */
const row = (id: string, stand: Stand, more: Partial<Listed> = {}): Row => ({
  project: PROJECT,
  stand,
  listed: {
    id,
    title: id,
    mark: "done",
    seen: true,
    changed: 0,
    pane: { kind: "agents.thread", args: { thread: id } },
    ...more,
  },
})

const asks = (id: string) => row(id, "turn", { mark: "asking" })

/** The sidebar's keys as Banda binds them. */
const KEYS = new Map([
  ["sidebar.archive-picked", { code: "KeyS" }],
  ["sidebar.later-picked", { code: "KeyZ" }],
  ["sidebar.unread-picked", { code: "KeyU" }],
])

let root: Root | undefined

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

/** The bar over `rows`, with what it is told to do, and a list to give
 * the focus back to. */
function drawn(rows: readonly Row[]) {
  const onAct = vi.fn()
  const onClear = vi.fn()
  const list = createRef<HTMLDivElement>()
  const host = document.createElement("div")
  document.body.append(host)
  root ??= createRoot(host)
  const draw = (now: readonly Row[]) =>
    act(() =>
      root!.render(
        <KeysInForce
          value={{
            mod: DEFAULT_KEYS.mod,
            byAction: KEYS,
            byScope: new Map(),
          }}
        >
          <div ref={list} tabIndex={0} role="listbox" />
          <Bulk value={{ rows: now, onAct, onClear, list }}>
            <BulkBar />
          </Bulk>
        </KeysInForce>
      )
    )
  draw(rows)
  const bar = document.querySelector<HTMLElement>('[role="toolbar"]')!
  const button = (does: string) =>
    bar.querySelector<HTMLButtonElement>(`[data-does="${does}"]`)!
  return { bar, button, onAct, onClear, list, draw }
}

test("with nothing checked the bar is not there for the keys or a screen reader", () => {
  const { bar } = drawn([])
  expect(bar.hasAttribute("data-shown")).toBe(false)
  expect(bar.inert).toBe(true)
})

test("three checked: a toolbar named 3 selected, Archive, Later, Unread and ✕, each with its key", () => {
  const rows = [row("a", "turn"), row("b", "turn"), row("c", "open")]
  const { bar, button, onAct, onClear } = drawn(rows)
  expect(bar.getAttribute("aria-label")).toBe("3 selected")
  expect(bar.textContent).toBe("3 selected")
  expect(bar.hasAttribute("data-shown")).toBe(true)
  const titles = [...bar.querySelectorAll("button")].map((one) => one.title)
  expect(titles).toEqual([
    "Archive (S)",
    "Later (Z)",
    "Mark as unread (U)",
    "Clear the selection (Esc)",
  ])
  expect(bar.querySelectorAll('[aria-disabled="true"]')).toHaveLength(0)
  act(() => button("archive").click())
  expect(onAct).toHaveBeenCalledWith("archive", button("archive"))
  act(() => button("later").click())
  expect(onAct).toHaveBeenLastCalledWith("later", button("later"))
  act(() => button("clear").click())
  expect(onClear).toHaveBeenCalledOnce()
})

test("Archive does nothing where every card asks, and its tooltip says why; it stays in the Tab order", () => {
  const { button, onAct } = drawn([asks("a"), asks("b")])
  const archive = button("archive")
  expect(archive.getAttribute("aria-disabled")).toBe("true")
  expect(archive.title).toBe("They ask you. Z puts them off.")
  expect(archive.tabIndex).toBe(0)
  act(() => archive.click())
  expect(onAct).not.toHaveBeenCalled()
  // Later puts them off; Unread leaves a question until it is answered.
  expect(button("later").hasAttribute("aria-disabled")).toBe(false)
  expect(button("unread").title).toBe("A question waits until it's answered.")
  // One at work too: the words say so.
  const { button: mixed } = drawn([asks("a"), row("w", "working")])
  expect(mixed("archive").title).toBe(
    "They ask you or are at work. Z puts them off."
  )
})

test("in the Archive, Archive brings back and Later does nothing; none read, Unread marks them read", () => {
  const { button } = drawn([row("a", "archived"), row("b", "archived")])
  expect(button("archive").getAttribute("aria-label")).toBe("Unarchive")
  expect(button("later").getAttribute("aria-disabled")).toBe("true")
  const { button: unseen } = drawn([
    row("a", "turn", { seen: false }),
    row("b", "turn", { seen: false }),
  ])
  expect(unseen("unread").title).toBe("Mark as read (U)")
})

test("←/→ walk its buttons, one Tab stop; gone with the focus in it, the list takes the focus", () => {
  const { bar, button, list, draw } = drawn([row("a", "turn")])
  button("archive").focus()
  act(() => {
    bar.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
    )
  })
  expect(document.activeElement).toBe(button("later"))
  expect(button("later").tabIndex).toBe(0)
  expect(button("archive").tabIndex).toBe(-1)
  act(() => {
    bar.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true })
    )
  })
  expect(document.activeElement).toBe(button("clear"))
  // Cleared: it still says how many it had as it goes, and the focus is
  // the list's, never the page's.
  draw([])
  expect(bar.getAttribute("aria-label")).toBe("1 selected")
  expect(document.activeElement).toBe(list.current)
})
