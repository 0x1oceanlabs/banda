import type { Tree } from "@banda/contract/apps"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { TreeView } from "./TreeView"

const send = () => Promise.resolve()

// As a machine on a Banda before the Tree grew answers it: with none of
// the props that came later, which the window draws all the same.
const TREE = {
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
} as unknown as Tree

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
  const newer = { node: "Gauge", value: 3 } as unknown as Tree["children"][0]
  const badge = {
    node: "Badge" as const,
    text: "3 notes",
    tone: "plain" as const,
  }
  const html = renderToStaticMarkup(
    <TreeView tree={{ ...TREE, children: [newer, badge] }} send={send} />
  )
  expect(words(html).slice(1)).toEqual([
    "Update Banda to see this part.",
    "3 notes",
  ])
})

test("the nodes that hold nodes draw them, a number stands large, and a row has what can be done with it", () => {
  const edit = {
    title: null,
    command: "update",
    submit: "Edit",
    fields: [],
  }
  const tree: Tree = {
    at: 7,
    title: "Deals",
    about: null,
    children: [
      {
        node: "Grid",
        columns: 2,
        children: [
          {
            node: "Stat",
            label: "Open deals",
            value: 1200,
            about: "+3 this week",
            tone: "good",
          },
          { node: "Progress", value: 3, max: 4, label: "Quarter" },
        ],
      },
      {
        node: "Tabs",
        tabs: [
          {
            title: "All",
            children: [
              {
                node: "Table",
                empty: null,
                search: true,
                columns: [
                  { key: "name", title: "Name", as: "text", tones: {} },
                  {
                    key: "stage",
                    title: "Stage",
                    as: "badge",
                    tones: { won: "good" },
                  },
                  { key: "paid", title: "Paid", as: "check", tones: {} },
                ],
                rows: [{ id: 1, name: "Anna", stage: "won", paid: true }],
                actions: [
                  {
                    label: "Edit",
                    command: "update",
                    params: {},
                    take: { id: "id" },
                    confirm: null,
                    form: edit,
                    tone: "plain",
                  },
                  {
                    label: "Delete",
                    command: "remove",
                    params: {},
                    take: { id: "id" },
                    confirm: "Delete Anna?",
                    form: null,
                    tone: "bad",
                  },
                ],
              },
            ],
          },
          {
            title: "Late",
            children: [
              {
                node: "Alert",
                title: "Two invoices are late",
                about: null,
                tone: "warn",
              },
            ],
          },
        ],
      },
    ],
  }
  const html = renderToStaticMarkup(<TreeView tree={tree} send={send} />)
  const said = words(html)
  for (const word of [
    "Open deals",
    "1,200",
    "+3 this week",
    "Quarter",
    "75%",
    "All",
    "Late",
    "Anna",
    "won",
    "Edit",
    "Delete",
  ])
    expect(said).toContain(word)
  // A tone is the theme's colour, and a tick stands for true.
  expect(html).toContain("text-added")
  expect(html).toContain('aria-label="Yes"')
  expect(html).toContain('aria-label="Find rows"')
})
