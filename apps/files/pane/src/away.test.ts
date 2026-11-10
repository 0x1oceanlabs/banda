/**
 * A move and a copy while the Project's machine is away (ADR 0106, law
 * 4): each is refused at once, in a toast that names the machine and the
 * act, and none waits to run once the machine is back.
 */
import { Engine, type ProjectId, Unreachable } from "@banda/contract"
import { expect, test, vi } from "vitest"

const said = vi.hoisted(() => ({ errors: [] as string[] }))
vi.mock("@banda/ui/components/sonner", () => ({
  toast: Object.assign(() => undefined, {
    dismiss: () => undefined,
    error: (words: string) => said.errors.push(words),
  }),
}))
const { transfer } = await import("./acts")

/** arc's engine while arc is away: it is never reached. */
const arc = () =>
  new Engine(() => Promise.reject(new Unreachable("arc", "arc is away")))

test("a move and a copy into arc's folder while arc is away are refused at once, naming arc and the act", async () => {
  const at = { engine: arc(), project: "p" as ProjectId }
  const ask = () => Promise.resolve(null)
  const move = { copy: false, paths: ["a.txt"], dir: "b", ask }
  expect(await transfer(at, move)).toBeNull()
  expect(await transfer(at, { ...move, copy: true })).toBeNull()
  expect(said.errors).toEqual([
    "arc is away: the move was not sent.",
    "arc is away: the copy was not sent.",
  ])
})
