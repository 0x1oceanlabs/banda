import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import type { Here } from "../here"
import { Store } from "../store"
import { HereContext, useHere } from "./here"

const project = (here: Here) => here.project
const subject = (here: Here) => here.pane?.subject ?? "none"

function Reads() {
  return (
    <>
      {useHere(project)}/{useHere(subject)}
    </>
  )
}

test("a reader draws what it selects of its Window's Here", () => {
  const here = new Store<Here>({
    front: true,
    sidebar: false,
    workspace: { id: "w", project: "a" },
    pane: { id: "p", project: "a", subject: "t1" },
    project: "a",
    starts: "a",
  })
  expect(
    renderToStaticMarkup(
      <HereContext value={here}>
        <Reads />
      </HereContext>
    )
  ).toBe("a/t1")
})

test("outside a Window, Here is nowhere", () => {
  expect(renderToStaticMarkup(<Reads />)).toBe("/none")
})
