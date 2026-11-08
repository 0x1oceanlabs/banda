import { expect, test } from "vitest"
import { seeded } from "../src/workspaces"

test("a command's ID names what it makes, as the engine's Seed does", () => {
  // The same IDs model.rs pins for this command.
  const command = "019a5b2e-3c4d-7e8f-9a0b-1c2d3e4f5a6b"
  const made = (seed: string) =>
    (["pane", "column", "group", "workspace", "bottom"] as const).map((what) =>
      seeded(seed, what)
    )
  expect(made(command)).toEqual([
    "c49cdec1-36c4-59c6-9215-554a09037c79",
    "ef9bdcfe-a6cb-52bc-8e8e-ecf20571e3d3",
    "261add3f-07a6-510a-b069-095879867c1b",
    "5a8a51cf-67bf-5625-9d42-0e39763337a4",
    "f0119e3e-3c94-5e7c-bb09-0c2d2d63349f",
  ])
  // Written otherwise, it is the same command to the engine.
  expect(made(command.toUpperCase())).toEqual(made(command))
})
