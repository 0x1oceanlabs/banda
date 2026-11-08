import { afterEach, expect, test, vi } from "vitest"

/** The clock afresh, over animation frames the test runs by hand. */
async function clock() {
  vi.resetModules()
  const asked: ((now: number) => void)[] = []
  vi.stubGlobal("requestAnimationFrame", (run: (now: number) => void) =>
    asked.push(run)
  )
  const frames = await import("./frames")
  let now = 0
  return {
    ...frames,
    /** The animation frames asked for and not run yet. */
    asked: () => asked.length,
    /** Runs the next animation frame, if one was asked for. */
    tick() {
      now += 16
      for (const run of asked.splice(0)) run(now)
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

test("the clock asks for a tick only when something does, and stops once nothing does", async () => {
  const time = await clock()
  expect(time.asked()).toBe(0)
  let steps = 0
  const step = () => {
    steps += 1
    if (steps < 3) time.onMove(step)
  }
  time.onMove(step)
  time.onMove(() => {})
  // Two asked, one tick.
  expect(time.asked()).toBe(1)
  for (let i = 0; i < 5; i++) time.tick()
  expect(steps).toBe(3)
  expect(time.asked()).toBe(0)
})

test("a tick runs the moves, then what reads after them, then the followers, then what draws", async () => {
  const time = await clock()
  const ran: string[] = []
  time.onDraw(() => ran.push("draws"))
  time.followMoves(() => ran.push("follows"))
  time.afterMoves(() => ran.push("reads"))
  time.onMove(() => ran.push("moves"))
  time.tick()
  expect(ran).toEqual(["moves", "reads", "follows", "draws"])
})

test("a follower runs in a tick something moved in, and asks for none", async () => {
  const time = await clock()
  let followed = 0
  time.followMoves(() => (followed += 1))
  expect(time.asked()).toBe(0)
  // A tick that only reads moved nothing.
  time.afterMoves(() => {})
  time.tick()
  expect(followed).toBe(0)
  time.onMove(() => {})
  time.tick()
  expect(followed).toBe(1)
  expect(time.asked()).toBe(0)
})

test("a jump outside a tick asks one for the followers, and one inside it runs them there", async () => {
  const time = await clock()
  let followed = 0
  time.followMoves(() => (followed += 1))
  time.moved()
  time.moved()
  expect(time.asked()).toBe(1)
  time.tick()
  expect(followed).toBe(1)
  // What the overview writes after the moves, the page follows that tick.
  time.afterMoves(() => time.moved())
  time.tick()
  expect(followed).toBe(2)
  expect(time.asked()).toBe(0)
})

test("a follower asked again runs in the next tick, alone, and a stopped one never", async () => {
  const time = await clock()
  const ran: string[] = []
  const page = time.followMoves(() => ran.push("page"))
  const other = time.followMoves(() => ran.push("other"))
  page.again()
  time.tick()
  expect(ran).toEqual(["page"])
  // Asked again from its own run, it runs in the tick after.
  const again = time.followMoves(() => {
    ran.push("again")
    if (ran.filter((each) => each === "again").length < 2) again.again()
  })
  again.again()
  time.tick()
  time.tick()
  time.tick()
  expect(ran).toEqual(["page", "again", "again"])
  other.stop()
  other.again()
  time.onMove(() => {})
  time.tick()
  expect(ran.slice(3)).toEqual(["page", "again"])
  expect(time.asked()).toBe(0)
})

test("a follower that runs first runs before the others, and they follow what it moved in that tick", async () => {
  const time = await clock()
  const ran: string[] = []
  time.followMoves(() => ran.push("page"))
  const overview = time.followMoves(
    () => {
      ran.push("overview")
      time.moved()
    },
    { first: true }
  )
  // Asked alone, it moves the Panes, and the page follows them.
  overview.again()
  time.tick()
  expect(ran).toEqual(["overview", "page"])
  expect(time.asked()).toBe(0)
  time.onMove(() => {})
  time.tick()
  expect(ran.slice(2)).toEqual(["overview", "page"])
  expect(time.asked()).toBe(0)
})

test("a jump told once the last followers know whether they run is the next tick's", async () => {
  const time = await clock()
  const ran: string[] = []
  time.followMoves(() => ran.push("page"))
  let jumps = 1
  const other = time.followMoves(() => {
    ran.push("other")
    if (jumps-- > 0) time.moved()
  })
  // Asked alone, it jumps: the page has not run, and runs in the next.
  other.again()
  time.tick()
  expect(ran).toEqual(["other"])
  expect(time.asked()).toBe(1)
  time.tick()
  expect(ran).toEqual(["other", "page", "other"])
  expect(time.asked()).toBe(0)
})

test("what is taken back runs not, even in the tick it was to run in", async () => {
  const time = await clock()
  let ran = 0
  time.cancelFrame(time.onMove(() => (ran += 1)))
  time.cancelFrame(time.afterMoves(() => (ran += 1)))
  time.cancelFrame(time.onDraw(() => (ran += 1)))
  time.tick()
  expect(ran).toBe(0)
  expect(time.asked()).toBe(0)
  // A move takes back what was to read after it, and to draw.
  const read = time.afterMoves(() => (ran += 1))
  const draw = time.onDraw(() => (ran += 1))
  time.onMove(() => {
    time.cancelFrame(read)
    time.cancelFrame(draw)
  })
  time.tick()
  expect(ran).toBe(0)
})

test("a run that throws is reported, and every other run of its tick runs", async () => {
  const time = await clock()
  const reported: unknown[] = []
  vi.stubGlobal("reportError", (error: unknown) => reported.push(error))
  const broken = (what: string) => () => {
    throw new Error(what)
  }
  const ran: string[] = []
  time.followMoves(broken("a broken overview"), { first: true })
  time.followMoves(() => ran.push("follows"))
  time.onMove(broken("a broken step"))
  time.onMove(() => ran.push("moves"))
  time.afterMoves(broken("a broken screen"))
  time.afterMoves(() => ran.push("reads"))
  time.onDraw(broken("a broken mark"))
  time.onDraw(() => ran.push("draws"))
  time.tick()
  expect(ran).toEqual(["moves", "reads", "follows", "draws"])
  expect(reported.map((error) => (error as Error).message)).toEqual([
    "a broken step",
    "a broken screen",
    "a broken overview",
    "a broken mark",
  ])
  // What asks next is heard.
  time.onDraw(() => ran.push("again"))
  expect(time.asked()).toBe(1)
  time.tick()
  expect(ran.at(-1)).toBe("again")
})
