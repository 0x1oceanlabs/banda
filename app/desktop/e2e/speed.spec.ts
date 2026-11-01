/**
 * How fast the window feels, measured on the real app: start-up, memory,
 * a keystroke's way to the screen, and a message's way to its reply. The
 * budgets are loose, to catch a regression, not to tune; the numbers go
 * to test-results/speed.json.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/**
 * The memory a process tree really uses, in MB: each process's
 * proportional share (PSS), so pages shared between them count once.
 * Linux only; the engine is reported on its own.
 */
function memoryOf(root: number): { total: number; engine: number } {
  const parents = new Map<number, number>()
  const names = new Map<number, string>()
  for (const entry of readdirSync("/proc")) {
    const pid = Number(entry)
    if (!Number.isInteger(pid)) continue
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
      const close = stat.lastIndexOf(")")
      names.set(pid, stat.slice(stat.indexOf("(") + 1, close))
      parents.set(pid, Number(stat.slice(close + 2).split(" ")[1]))
    } catch {
      // It ended while we looked.
    }
  }
  const tree = [root]
  for (let i = 0; i < tree.length; i++) {
    for (const [pid, parent] of parents) if (parent === tree[i]) tree.push(pid)
  }
  const pss = (pid: number) => {
    try {
      const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8")
      return Number(/^Pss:\s+(\d+)/m.exec(rollup)?.[1] ?? 0)
    } catch {
      return 0
    }
  }
  const mb = (kb: number) => Math.round(kb / 1024)
  const engine = tree.filter((pid) => names.get(pid) === "bandaso")
  return {
    total: mb(tree.reduce((sum, pid) => sum + pss(pid), 0)),
    engine: mb(engine.reduce((sum, pid) => sum + pss(pid), 0)),
  }
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return (
    Math.round(
      sorted[
        Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
      ] * 10
    ) / 10
  )
}

test("the window starts fast, stays small and answers keys at once", async () => {
  const launched = Date.now()
  window = await startWindow()
  const { app, page } = window
  await expect(page.getByText("Create your first Space")).toBeVisible()
  const startup = Date.now() - launched

  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()

  // A keystroke's way: from the key to the frame that shows it.
  await page.evaluate(() => {
    const seen: number[] = []
    ;(window as unknown as { keystrokes: number[] }).keystrokes = seen
    document.addEventListener(
      "keydown",
      (event) => {
        const start = event.timeStamp
        requestAnimationFrame(() =>
          setTimeout(() => seen.push(performance.now() - start))
        )
      },
      { capture: true }
    )
  })
  await composer.pressSequentially(
    "the quick brown fox jumps over the lazy dog",
    { delay: 30 }
  )
  const keystrokes = await page.evaluate(
    () => (window as unknown as { keystrokes: number[] }).keystrokes
  )
  await composer.fill("")

  const replies: number[] = []
  for (const word of ["hello", "again", "once more"]) {
    await composer.fill(word)
    const sent = Date.now()
    await composer.press("Enter")
    await expect(thread.getByText(`You said: ${word}`)).toBeVisible()
    replies.push(Date.now() - sent)
  }

  const memory =
    process.platform === "linux" ? memoryOf(app.process().pid!) : undefined

  const numbers = {
    startupMs: startup,
    keystrokeMs: {
      p50: percentile(keystrokes, 50),
      p95: percentile(keystrokes, 95),
      count: keystrokes.length,
    },
    replyMs: { first: replies[0], next: replies.slice(1) },
    memoryMb: memory,
  }
  writeFileSync(
    "test-results/speed.json",
    `${JSON.stringify(numbers, null, 2)}\n`
  )
  console.log(JSON.stringify(numbers))

  expect(startup).toBeLessThan(10_000)
  expect(percentile(keystrokes, 95)).toBeLessThan(100)
  expect(Math.max(...replies.slice(1))).toBeLessThan(3_000)
  if (memory) expect(memory.total).toBeLessThan(1024)
})
