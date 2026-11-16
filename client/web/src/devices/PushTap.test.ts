import { base64url } from "@banda/contract"
import { expect, it } from "vitest"
import { toldOf } from "./PushTap"

it("a push's tap says where to go, and nothing else in an address does", () => {
  const pick = {
    project: "01a1e679-0a45-7099-87bb-3d7f523bf38e",
    pane: { kind: "some.kind", args: { thread: "01a1e679", title: "Привет" } },
  }
  const said = base64url(new TextEncoder().encode(JSON.stringify(pick)))
  // As the machine says it, and as the page's own address has it.
  expect(toldOf(`./#go/${said}`)).toEqual({ project: pick.project, pick })
  expect(toldOf(`#go/${said}`)?.pick).toEqual(pick)
  // A Pane in a window of its own, no address, a word of another kind,
  // and what does not read.
  expect(toldOf("#pane/01a1e679")).toBeUndefined()
  expect(toldOf("")).toBeUndefined()
  expect(toldOf(undefined)).toBeUndefined()
  expect(toldOf("#go/not-json")).toBeUndefined()
  expect(
    toldOf(`#go/${base64url(new TextEncoder().encode("[1]"))}`)
  ).toBeUndefined()
})
