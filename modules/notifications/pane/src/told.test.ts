import { expect, test } from "vitest"
import { toldOf } from "./told"

test("what a module tells may name its Project and the thing it is of", () => {
  const told = { key: "git.s", kind: "done", title: "Pushed", buttons: [] }
  expect(toldOf({ ...told, in: "s", about: "t" })).toEqual({
    ...told,
    in: "s",
    about: "t",
  })
  expect(toldOf({ ...told, in: 7 })).toEqual(told)
})
