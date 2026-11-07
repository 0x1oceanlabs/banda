import { describe, expect, test, vi } from "vitest"
import { framesOf, fromRoot, keeper, recordOf } from "../src/problems"

const own = (script: string) =>
  script.includes("/node_modules/") ? null : fromRoot(script)

/** No script has a map. */
const none = () => Promise.resolve(null)

describe("a JavaScript error as a Record", () => {
  test("keeps Banda's own frames, nearest first, with their functions", async () => {
    const stack = [
      "TypeError: reading 'tabs'",
      "    at title (http://localhost:5173/@fs/home/x/banda/client/web/src/browser/Tabs.tsx?t=1:83:12)",
      "    at http://localhost:5173/node_modules/.vite/deps/react-dom.js:10:3",
      "    at async new Loader (/home/x/banda/apps/git/pane/src/load.ts:4:1)",
      "    at node:internal/process/task_queues:95:5",
    ].join("\n")
    expect(await framesOf(stack, own, none)).toEqual([
      { file: "client/web/src/browser/Tabs.tsx", function: "title", line: 83 },
      { file: "apps/git/pane/src/load.ts", function: "Loader", line: 4 },
    ])
  })

  test("names a built script's frames as its map names its sources", async () => {
    const script =
      "app://banda/home/x/banda/client/web/dist/assets/index-YK0wjMBr.js"
    // The built index's map, as the build writes it beside the script:
    // its sources from client/web/dist/assets, and no text of them. Line 1,
    // column 100 is Tabs.tsx's line 41; column 200, a library's.
    const map = {
      version: 3,
      sources: [
        "../../src/browser/Tabs.tsx",
        "../../../../apps/git/web/src/Commit.tsx",
        "../../../../node_modules/react/index.js",
      ],
      names: [],
      mappings: [
        [
          [99, 0, 40, 4],
          [149, 1, 11, 2],
          [199, 2, 9, 0],
        ],
      ],
    }
    const mapOf = vi.fn((of: string) =>
      Promise.resolve(of === script ? map : null)
    )
    const stack = [
      "TypeError: reading 'tabs'",
      `    at Xe (${script}:1:100)`,
      `    at async Qr (${script}:1:150)`,
      `    at Zt (${script}:1:200)`,
      "    at /home/x/banda/client/desktop/out/main.mjs:3:7",
    ].join("\n")
    expect(await framesOf(stack, own, mapOf)).toEqual([
      { file: "client/web/src/browser/Tabs.tsx", function: "", line: 41 },
      { file: "apps/git/web/src/Commit.tsx", function: "", line: 12 },
      // A script with no map is named as it is.
      { file: "client/desktop/out/main.mjs", function: "", line: 3 },
    ])
    // Each script's map is read once for the stack.
    expect(mapOf).toHaveBeenCalledTimes(2)
  })

  test("says what was thrown that is not an Error", async () => {
    expect(await recordOf({ said: 1 }, "page", own, none)).toMatchObject({
      source: "page",
      kind: "Error",
      message: '{"said":1}',
    })
    expect((await recordOf("gone", "main", own, none)).message).toBe("gone")
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
