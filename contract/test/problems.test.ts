import { describe, expect, test, vi } from "vitest"
import { framesOf, fromRoot, keeper, recordOf } from "../src/problems"

const own = (script: string) =>
  script.includes("/node_modules/") ? null : fromRoot(script)

describe("a JavaScript error as a Record", () => {
  test("keeps Banda's own frames, nearest first, with their functions", () => {
    const stack = [
      "TypeError: reading 'tabs'",
      "    at title (http://localhost:5173/@fs/home/x/banda/app/web/src/browser/Tabs.tsx?t=1:83:12)",
      "    at http://localhost:5173/node_modules/.vite/deps/react-dom.js:10:3",
      "    at async new Loader (/home/x/banda/modules/git/pane/src/load.ts:4:1)",
      "    at node:internal/process/task_queues:95:5",
    ].join("\n")
    expect(framesOf(stack, own)).toEqual([
      { file: "app/web/src/browser/Tabs.tsx", function: "title", line: 83 },
      { file: "modules/git/pane/src/load.ts", function: "Loader", line: 4 },
    ])
  })

  test("says what was thrown that is not an Error", () => {
    expect(recordOf({ said: 1 }, "page", own)).toMatchObject({
      source: "page",
      kind: "Error",
      message: '{"said":1}',
    })
    expect(recordOf("gone", "main", own).message).toBe("gone")
  })
})

test("twenty Records a minute are sent at most", () => {
  vi.useFakeTimers()
  const send = vi.fn(() => Promise.resolve())
  const keep = keeper(send)
  const record = {
    source: "page" as const,
    kind: "Error",
    message: "a",
    frames: [],
  }
  for (let n = 0; n < 30; n++) keep(record)
  expect(send).toHaveBeenCalledTimes(20)
  vi.advanceTimersByTime(60_001)
  keep(record)
  expect(send).toHaveBeenCalledTimes(21)
  vi.useRealTimers()
})
