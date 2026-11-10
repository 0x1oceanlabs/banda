/**
 * The Pane menu's "To workspace" row shows the workspaces as the bar does,
 * a Project's by its Sign, and greys out those the keys refuse (ADR 0102,
 * decision 6). It is drawn to text, its menu's rows as plain buttons: the
 * menu itself draws only once opened.
 */
import type { ProjectSummary } from "@banda/contract"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"
import { PaneMenu, type Stand } from "./PaneMenu"

vi.mock("@banda/ui/components/dropdown-menu", () => {
  const plain = ({ children }: { children?: ReactNode }) => <>{children}</>
  return {
    DropdownMenuGroup: plain,
    DropdownMenuLabel: plain,
    DropdownMenuSeparator: () => null,
    DropdownMenuShortcut: plain,
    DropdownMenuItem: ({
      children,
      disabled,
      title,
      "aria-label": label,
    }: {
      children?: ReactNode
      disabled?: boolean
      title?: string
      "aria-label"?: string
    }) => (
      <button
        type="button"
        disabled={disabled}
        title={title}
        aria-label={label}
      >
        {children}
      </button>
    ),
  }
})

const brand = {
  id: "brand",
  name: "Brand",
  sign: { kind: "letters", text: "BR", picked: false },
  trusted: true,
  scratch: false,
} as unknown as ProjectSummary
const banda = {
  ...brand,
  id: "banda",
  name: "Banda",
  sign: { ...brand.sign, text: "BA" },
}

const stand: Stand = {
  width: 0.5,
  full: false,
  deck: false,
  panes: 1,
  height: 1,
  left: false,
  right: false,
  workspace: 1,
  targets: [
    { owner: banda, refused: false },
    { owner: brand, refused: true },
    { refused: false },
    { refused: false },
  ],
  away: false,
  presets: [],
  heights: [],
  floor: 0,
  items: [],
}

test("To workspace shows a Project's workspace by its Sign, and greys out the ones the Pane may not go to", () => {
  const markup = renderToStaticMarkup(
    <PaneMenu
      entry="e"
      stand={stand}
      frame={{ run: () => {} }}
      zoomed={false}
    />
  )
  const offered = [
    ...markup.matchAll(/<button[^>]*aria-label="To [^"]+"[^>]*>/g),
  ].map(([button]) => button)
  // The markup writes an apostrophe as its entity.
  const label = (one: string) =>
    /aria-label="([^"]+)"/.exec(one)?.[1].replaceAll("&#x27;", "'")
  expect(offered.map(label)).toEqual([
    "To workspace 1, Banda's",
    "To workspace 2, Brand's",
    "To workspace 3",
    "To a new workspace",
  ])
  // Its own, and Brand's, which the keys refuse.
  expect(offered.map((one) => one.includes("disabled"))).toEqual([
    true,
    true,
    false,
    false,
  ])
  // The Signs, as the bar draws them, and the free one by its number.
  expect(markup).toContain(">BA<")
  expect(markup).toContain(">BR<")
  expect(markup).toMatch(/aria-label="To workspace 3"[^>]*>3<\/button>/)
})
