import type { Tree } from "@banda/contract/apps"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { TreeView } from "./TreeView"

const send = () => Promise.resolve()

const TREE: Tree = {
  at: 7,
  title: "Clients",
  about: "The people I work with.",
  children: [
    {
      node: "Table",
      empty: "No clients yet",
      columns: [
        { key: "name", title: "Name", as: "text" },
        { key: "city", title: "City", as: "text" },
        { key: "notes", title: "Notes", as: "badge" },
      ],
      rows: [
        { name: "Anna", city: "Berlin", notes: 3 },
        { name: "Boris", city: null, notes: null },
      ],
    },
    {
      node: "Card",
      title: "Add a client",
      children: [
        {
          node: "Form",
          title: null,
          command: "add",
          submit: "Add client",
          fields: [
            {
              name: "name",
              label: "Name",
              kind: "text",
              required: true,
              placeholder: null,
              options: [],
            },
            {
              name: "vip",
              label: "Vip",
              kind: "checkbox",
              required: false,
              placeholder: null,
              options: [],
            },
          ],
        },
      ],
    },
  ],
}

/** The page's words, tag by tag. */
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((word) => word.trim())
    .filter(Boolean)

test("a Tree is drawn node by node: what it is for, a table's rows, a card and its form", () => {
  const html = renderToStaticMarkup(<TreeView tree={TREE} send={send} />)
  expect(words(html)).toEqual([
    // Its title is its frame's to say.
    "The people I work with.",
    "Name",
    "City",
    "Notes",
    "Anna",
    "Berlin",
    "3",
    "Boris",
    // A cell with nothing says so.
    "—",
    "—",
    "Add a client",
    "Name",
    "*",
    "Vip",
    "Add client",
  ])
  // A badge sets a cell apart; a required field says so to a reader.
  expect(html).toContain('data-slot="badge"')
  expect(html).toContain('aria-required="true"')
})

test("a table with no rows says its words for it", () => {
  const table = { ...TREE.children[0]!, rows: [] }
  const html = renderToStaticMarkup(
    <TreeView tree={{ ...TREE, children: [table] }} send={send} />
  )
  expect(words(html)).toEqual(["The people I work with.", "No clients yet"])
})

test("a node this window does not have yet is said in its place, and the rest is drawn", () => {
  const newer = { node: "Chart", series: [] } as unknown as Tree["children"][0]
  const badge = { node: "Badge" as const, text: "3 notes" }
  const html = renderToStaticMarkup(
    <TreeView tree={{ ...TREE, children: [newer, badge] }} send={send} />
  )
  expect(words(html).slice(1)).toEqual([
    "Update Banda to see this part.",
    "3 notes",
  ])
})
