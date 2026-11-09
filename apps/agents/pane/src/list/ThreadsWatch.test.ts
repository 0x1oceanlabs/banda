import type { Engine, ProjectId } from "@banda/contract"
import { afterEach, expect, test, vi } from "vitest"
import { move } from "./marks-moved"
import { watchedSource } from "./ThreadsWatch"

afterEach(() => {
  vi.restoreAllMocks()
})

// Another host's list reads without waiting for this machine's marks to
// move, because the Watch tells the move whose host it is (#1061).
test("the Watch reads a Project's Threads once the marks moved, telling the move its host", async () => {
  const over = vi.spyOn(move, "over").mockResolvedValue()
  const engine = {
    call: async () => ({ at: 7, threads: [] }),
  } as unknown as Engine
  const project = "p" as ProjectId
  await watchedSource(engine, project, "arc").read()
  await watchedSource(engine, project, undefined).read()
  expect(over.mock.calls).toEqual([
    [engine, project, "arc"],
    [engine, project, undefined],
  ])
})
