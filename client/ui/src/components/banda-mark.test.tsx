import { readFileSync } from "node:fs"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, test, vi } from "vitest"
import { LOOPED, LOOPS } from "../lib/mark-rhythm"
import type { Listed } from "../pane"
import {
  BandaMark,
  groupState,
  MARK_ORDER,
  type MarkState,
  stillMark,
  ThreadMark,
} from "./banda-mark"

const colors = {
  body: "#111",
  attention: "#f60",
  destructive: "#e00",
  added: "#0a0",
  woke: "#fc0",
  muted: "#888",
}

/** Every state the mark draws, ADR 0099's seven looks among them. */
const STATES = Object.keys(MARK_ORDER) as MarkState[]

/** The outline a still mark draws in `state`, as its path's `d`. */
const outlineOf = (state: MarkState) => outlineIn(stillMark(state, colors))

/** The outline in a still mark's SVG. */
function outlineIn(still: string): string {
  return /<path d="([^"]+)" mask=/.exec(still)![1]!
}

test("a still mark is one SVG, in its look's colour and eyes", () => {
  const done = stillMark("done", colors)
  expect(done).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/)
  expect(done).toContain('fill="#0a0"')
  // Happy eyes are strokes.
  expect(done).toContain('stroke-linecap="round"')

  const asking = stillMark("asking", colors)
  expect(asking).toContain('fill="#f60"')
  expect(asking).toContain("<ellipse")

  // Failed is red, its eyes crossed.
  const failed = stillMark("failed", colors)
  expect(failed).toContain('fill="#e00"')
  expect(failed).toContain('stroke="#000"')

  // Woke rings its two bells, in its yellow.
  const woke = stillMark("woke", colors)
  expect(woke).toContain('fill="#fc0"')
  expect(woke.match(/<path d="M-7 1.5A7 7 0 0 1 7 1.5Z"/g)).toHaveLength(2)
  expect(done).not.toContain("M-7 1.5")

  // Later sleeps in the text's colour, its eyes closed as offline's are;
  // offline sleeps muted, not red (ADR 0099, decision 1).
  const later = stillMark("later", colors)
  expect(later).toContain('fill="#111"')
  const offline = stillMark("offline", colors)
  expect(offline).toContain('fill="#888"')
  expect(offline).not.toContain('fill="#e00"')
  const eyesOf = (still: string) => still.match(/<ellipse[^>]*>/g)
  expect(eyesOf(later)).toHaveLength(2)
  expect(eyesOf(later)).toEqual(eyesOf(offline))
  expect(eyesOf(later)).not.toEqual(eyesOf(stillMark("idle", colors)))

  // At rest it has no eyes at all.
  const rest = stillMark("rest", colors)
  expect(rest).not.toContain("<ellipse")
  expect(rest).not.toContain("stroke=")
})

// ADR 0099, decision 1: both asleep, offline with zz, Later with none.
test("still, offline snores and Later does not", () => {
  const zzOf = (state: MarkState) =>
    stillMark(state, colors).match(/<text[^>]*>z<\/text>/g) ?? []
  expect(zzOf("offline")).toHaveLength(3)
  expect(zzOf("later")).toHaveLength(0)
  // The same pose, in one colour, but for its zz.
  const offline = stillMark("offline", { ...colors, muted: colors.body })
  expect(offline.replace(/<g [^>]*font-family[^>]*>.*?<\/g>/, "")).toBe(
    stillMark("later", colors)
  )
  for (const state of STATES)
    if (state !== "offline") expect(zzOf(state), state).toHaveLength(0)
})

// Live, marks.css's `mark-zz` moves each z from where the mark draws it,
// about that point, so offline's snores rise as marks-final.html's: up and
// to the right, to twice their size, showing then fading. Each starts a
// third of the loop after the last (mark-rhythm.test.ts holds marks.css's
// delays).
test("live, offline's snores rise as the approved mock's do", () => {
  const css = readFileSync(
    new URL("../styles/marks.css", import.meta.url),
    "utf8"
  )
  const [ox, oy] = /\.mark-z \{\s*transform-origin: ([\d.-]+)px ([\d.-]+)px;/
    .exec(css)!
    .slice(1)
    .map(Number) as [number, number]
  const zs = snoresIn(
    renderToStaticMarkup(<BandaMark variant="agent" state="offline" />)
  )
  expect(zs).toHaveLength(3)
  for (const z of zs) {
    // Unseen until the loop shows it, at the foot it grows from.
    expect([z.x, z.y, z.opacity]).toEqual([ox, oy, 0])
    for (const [q, [dx, dy, scale, opacity]] of LOOPS.zz.keys) {
      // The mock's snore at `q` of its loop.
      const mock = [100 + 12 * q, 4 - 24 * q, 8 + 8 * q, Math.sin(Math.PI * q)]
      const drawn = [
        ox + dx! + scale! * (z.x - ox),
        oy + dy! + scale! * (z.y - oy),
        z.size * scale!,
        opacity!,
      ]
      drawn.forEach((value, at) =>
        expect(value, `${q}`).toBeCloseTo(mock[at]!, 3)
      )
    }
  }
  // The mock's loop is 1/0.45 s; marks.css's, 2.2 s.
  expect(LOOPS.zz.period).toBeCloseTo(1 / 0.45, 1)
  expect(LOOPED.offline).toContain("zz")
})

/** An SVG transform as a matrix, `[a b c d e f]`, as SVG writes one. */
type Matrix = readonly [number, number, number, number, number, number]

function times(m: Matrix, n: Matrix): Matrix {
  const [a, b, c, d, e, f] = m
  return [
    a * n[0] + c * n[1],
    b * n[0] + d * n[1],
    a * n[2] + c * n[3],
    b * n[2] + d * n[3],
    a * n[4] + c * n[5] + e,
    b * n[4] + d * n[5] + f,
  ]
}

/** The matrix of a transform of translates, rotates and scales. */
function matrixOf(transform: string): Matrix {
  let m: Matrix = [1, 0, 0, 1, 0, 0]
  for (const [, name, args] of transform.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const [x = 0, y, z] = args!
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    if (name === "translate") m = times(m, [1, 0, 0, 1, x, y ?? 0])
    else if (name === "scale") m = times(m, [x, 0, 0, y ?? x, 0, 0])
    else if (name === "rotate") {
      const a = (x * Math.PI) / 180
      const [cx, cy] = [y ?? 0, z ?? 0]
      m = times(m, [1, 0, 0, 1, cx, cy])
      m = times(m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0])
      m = times(m, [1, 0, 0, 1, -cx, -cy])
    } else throw new Error(`no ${name} in a mark`)
  }
  return m
}

const at = (m: Matrix, [x, y]: readonly [number, number]) =>
  [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] as const

/** Every point a still mark draws, where its box shows it: the hat's
 * outline, woke's bells, as their domes, and each z of a snore, as a box
 * a bold "z" of its size fits in. */
function drawnPoints(still: string): (readonly [number, number])[] {
  const hat = matrixOf(/<g transform="([^"]+)"/.exec(still)![1]!)
  const points = [...outlineIn(still).matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map(
    ([, x, y]) => at(hat, [Number(x), Number(y)])
  )
  for (const [, transform] of still.matchAll(
    /<path d="M-7 1.5A7 7 0 0 1 7 1.5Z" transform="([^"]+)"/g
  )) {
    const bell = times(hat, matrixOf(transform!))
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI
      points.push(at(bell, [7 * Math.cos(a), 1.5 - 7 * Math.sin(a)]))
    }
  }
  for (const [, x, y, size] of still.matchAll(
    /<text x="([\d.-]+)" y="([\d.-]+)" font-size="([\d.]+)"/g
  )) {
    const [left, base, em] = [Number(x), Number(y), Number(size)]
    points.push([left, base], [left + 0.6 * em, base - 0.6 * em])
  }
  return points
}

/** Where a still mark's points lie, least and most, across and down. */
function extent(points: readonly (readonly [number, number])[]) {
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  }
}

// ADR 0099, decision 8: a still mark is a picture outside the window,
// where nothing past its box shows: woke's bells, the triangle's tip
// and offline's zz must not be cut.
test("each look's still drawing fits its box, the hat about its middle", () => {
  for (const state of STATES) {
    const still = stillMark(state, colors)
    const [x, y, size] = /viewBox="([\d.-]+) ([\d.-]+) ([\d.]+) \3"/
      .exec(still)!
      .slice(1)
      .map(Number) as [number, number, number]
    const drawn = extent(drawnPoints(still))
    expect(drawn.left, state).toBeGreaterThanOrEqual(x)
    expect(drawn.right, state).toBeLessThanOrEqual(x + size)
    expect(drawn.top, state).toBeGreaterThanOrEqual(y)
    expect(drawn.bottom, state).toBeLessThanOrEqual(y + size)
    // Two pixels to a unit, as a live mark's box of 56 drew in 112.
    expect(still, state).toContain(`width="${size * 2}" height="${size * 2}"`)
    // The hat stands about the box's middle, whatever its look adds.
    const hat = extent(
      drawnPoints(still.replace(/<path d="M-7[^>]*>|<text[^>]*>z<\/text>/g, ""))
    )
    expect(
      Math.abs((hat.left + hat.right) / 2 - (x + size / 2)),
      state
    ).toBeLessThan(4)
    expect(
      Math.abs((hat.top + hat.bottom) / 2 - (y + size / 2)),
      state
    ).toBeLessThan(4)
  }
})

test("every state has a still pose", () => {
  for (const state of STATES)
    expect(stillMark(state, colors), state).toMatch(/<\/svg>$/)
})

// Shape is state (ADR 0099, decision 1): square, all is calm; circle, work
// goes on; triangle, it asks; octagon, it failed.
test("the looks of one shape draw one outline, and each shape its own", () => {
  const square = outlineOf("idle")
  for (const state of ["rest", "done", "woke", "later", "offline"] as const)
    expect(outlineOf(state), state).toBe(square)
  expect(outlineOf("thinking")).toBe(outlineOf("running"))
  const shapes = new Set(
    (["idle", "running", "asking", "failed"] as const).map(outlineOf)
  )
  expect(shapes.size).toBe(4)
})

test("failed is a stop sign: eight rounded corners on a circle", () => {
  const points = [
    ...outlineOf("failed").matchAll(/[ML]([\d.-]+) ([\d.-]+)/g),
  ].map(([, x, y]) => [Number(x) - 76, Number(y) - 22.5] as const)
  const far = points.map(([x, y]) => Math.hypot(x, y))
  // Every point is on an arc that rounds a corner: 18.6 out, by 4.2.
  expect(Math.max(...far)).toBeCloseTo(18.6 + 4.2, 1)
  expect(Math.min(...far)).toBeGreaterThan(22.5)
  // The farthest stand at its eight corners, 45° apart, a flat side up.
  const corners = new Set<number>()
  for (const [x, y] of points) {
    if (Math.hypot(x, y) < 22.79) continue
    const angle = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
    const corner = (Math.round((angle - 22.5) / 45) + 8) % 8
    expect(Math.abs(angle - (22.5 + 45 * corner)) % 360).toBeLessThan(5)
    corners.add(corner)
  }
  expect([...corners].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
})

test("a Group's colour, and a lent tab's, is its Agent's state", () => {
  expect(groupState("running")).toBe("working")
  expect(groupState("thinking")).toBe("working")
  expect(groupState("asking")).toBe("asking")
  expect(groupState("done")).toBe("done")
  expect(groupState("offline")).toBe("failed")
  expect(groupState("idle")).toBeUndefined()
  expect(groupState("rest")).toBeUndefined()
  expect(groupState("later")).toBeUndefined()
})

const listed: Listed = {
  id: "t",
  title: "t",
  mark: "asking",
  changed: 1,
  pane: { kind: "agents.thread", args: {} },
}

test("a Thread's mark draws its look when given one, and its mark until then", () => {
  const woke = renderToStaticMarkup(<ThreadMark listed={listed} look="woke" />)
  expect(woke).toContain('data-look="woke"')
  expect(woke).toContain('aria-label="Woke"')
  expect(renderToStaticMarkup(<ThreadMark listed={listed} />)).toContain(
    'data-look="asking"'
  )
  // Open is its own look's name, not a wait for the Person.
  expect(
    renderToStaticMarkup(<ThreadMark listed={listed} look="idle" />)
  ).toContain('aria-label="Open"')
})

// ADR 0099, decision 10: what calls no one weighs less, by the theme's
// tokens; a call keeps its colour, on its Agent.
test("a Thread's mark that calls no one takes its look's weight", () => {
  const svgClass = (look: MarkState) =>
    /<svg[^>]*class="([^"]*)"/.exec(
      renderToStaticMarkup(<ThreadMark listed={listed} look={look} />)
    )![1]!
  expect(svgClass("idle")).toContain("text-mark-open")
  expect(svgClass("running")).toContain("text-mark-working")
  expect(svgClass("thinking")).toContain("text-mark-working")
  expect(svgClass("later")).toContain("text-mark-later")
  for (const look of ["asking", "failed", "done", "woke", "rest"] as const)
    expect(svgClass(look), look).not.toContain("text-mark-")
})

// ADR 0107, decision 3: the logo at work has its hat in a working Mark's
// blue; a lone Agent's tile is coloured by who draws it, so the bar's
// counts stay grey.
test("the logo's hat at work is a working Mark's, and an Agent's tile alone is not", () => {
  for (const state of ["running", "thinking"] as const) {
    expect(renderToStaticMarkup(<BandaMark state={state} />), state).toMatch(
      /<g data-agent[^>]*class="text-mark-working"/
    )
    expect(
      renderToStaticMarkup(<BandaMark variant="agent" state={state} />),
      state
    ).not.toContain("text-mark-working")
  }
})

// ADR 0099, decision 9: the Agent's tile takes the colour; on the logo the
// two tiles under it stay the text's.
test("only the Agent takes its look's colour", () => {
  const logo = renderToStaticMarkup(<BandaMark state="woke" />)
  expect(logo).toMatch(/<g data-agent[^>]*class="text-woke"/)
  expect(logo.match(/<rect x="(0|52)"[^>]*fill="currentColor"/g)).toHaveLength(
    2
  )
  expect(logo).not.toMatch(/<svg[^>]*text-woke/)
  const failed = renderToStaticMarkup(
    <BandaMark variant="agent" state="failed" />
  )
  expect(failed).toMatch(/<g data-agent[^>]*class="text-destructive"/)
  // The engine gone, the logo's hat sleeps muted (ADR 0099, decision 1).
  expect(renderToStaticMarkup(<BandaMark state="offline" />)).toMatch(
    /<g data-agent[^>]*class="text-muted-foreground"/
  )
  // What calls for nothing takes the colour it is drawn in.
  const open = renderToStaticMarkup(<BandaMark variant="agent" state="idle" />)
  expect(open).not.toMatch(/<g data-agent[^>]*class=/)
  // Nor does a call whose colour is turned off, as the bar's counts do.
  const plain = renderToStaticMarkup(
    <BandaMark variant="agent" state="done" tone={false} />
  )
  expect(plain).not.toMatch(/<g data-agent[^>]*class=/)
})

/** A mark's CSS animations, as its motion starts them over. */
type Animations = { currentTime: number | null }[]

/** What a mark's motion writes to and listens on, kept by its parts: each
 * part's attributes, by the selector it was found by and its place. */
function svg(): {
  svg: SVGSVGElement
  /** The SVG's own attributes and style, without a selector. */
  attributes: (selector?: string, at?: number) => Record<string, string>
  animations: Animations
} {
  const parts = new Map<string, Record<string, string>>()
  const animations: Animations = [{ currentTime: 1234 }]
  const part = (key: string) => {
    const attributes: Record<string, string> = {}
    parts.set(key, attributes)
    return {
      setAttribute: (name: string, value: string) => {
        attributes[name] = value
      },
      removeAttribute: (name: string) => {
        delete attributes[name]
      },
      hasAttribute: (name: string) => name in attributes,
      toggleAttribute: (name: string, on: boolean) => {
        if (on) attributes[name] = ""
        else delete attributes[name]
        return on
      },
      style: {
        setProperty: (name: string, value: string) => {
          attributes[name] = value
        },
      },
      getAnimations: () => animations,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  }
  const element = {
    ...part("svg"),
    querySelector: (selector: string) => part(selector),
    // Two eyes, two lenses and two bells; two lids to an eye; three z's.
    querySelectorAll: (selector: string) =>
      Array.from(
        { length: { "[data-lid]": 4, "[data-zz] text": 3 }[selector] ?? 2 },
        (_, at) => part(`${selector}${at}`)
      ),
  } as unknown as SVGSVGElement
  return {
    svg: element,
    attributes: (selector = "svg", at) =>
      parts.get(at === undefined ? selector : `${selector}${at}`) ?? {},
    animations,
  }
}

/** The four turns a mark's pose is drawn in, as one transform. */
const turnsOf = (drawn: ReturnType<typeof svg>) =>
  ["[data-move]", "[data-turn]", "[data-size]", "[data-spin]"]
    .map((selector) => drawn.attributes(selector).transform)
    .join(" ")

/** Each z a mark snores: where it stands, how big, how much it shows; as
 * an SVG's markup writes them, or as a mark's motion wrote them. */
function snoresIn(mark: string | ReturnType<typeof svg>) {
  const zs =
    typeof mark === "string"
      ? [...mark.matchAll(/<text ([^>]*)>z<\/text>/g)].map(([, attributes]) =>
          Object.fromEntries(
            [...attributes!.matchAll(/([\w-]+)="([^"]*)"/g)].map(
              ([, name, value]) => [name, value]
            )
          )
        )
      : [0, 1, 2].map((at) => mark.attributes("[data-zz] text", at))
  return zs.map((z) => ({
    x: Number(z.x),
    y: Number(z.y),
    size: Number(z["font-size"]),
    opacity: Number(z.opacity),
  }))
}

/** Where a mark's loops start, in seconds, as marks.css reads it. */
const phaseIn = (drawn: ReturnType<typeof svg>) =>
  Number.parseFloat(drawn.attributes()["--mark-phase"]!)

type Seen = (entries: { target: unknown; isIntersecting: boolean }[]) => void

/** The marks' motion afresh, on a clock whose ticks and timers the test
 * runs by hand; with `reduced`, the Person asked for less motion, and with
 * `still`, for none (`html[data-still]`). */
async function motion({ reduced = false, still = false } = {}) {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
  const asked: ((now: number) => void)[] = []
  vi.stubGlobal("requestAnimationFrame", (run: (now: number) => void) =>
    asked.push(run)
  )
  let seen: Seen = () => {}
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(run: Seen) {
        seen = run
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.stubGlobal("matchMedia", () => ({
    matches: reduced,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  vi.stubGlobal("addEventListener", () => {})
  vi.stubGlobal("removeEventListener", () => {})
  // The page's root, which `[motion] off` marks.
  const html = new Set(still ? ["data-still"] : [])
  let changed = () => {}
  vi.stubGlobal("document", {
    documentElement: { hasAttribute: (name: string) => html.has(name) },
    hidden: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(run: () => void) {
        changed = run
      }
      observe() {}
      disconnect() {}
    }
  )
  const { Animator } = await import("./banda-mark")
  return {
    Animator,
    /** A mark of `variant` on `drawn`, first drawn in `state`, on the beat
     * of `beat`. */
    mark(
      drawn: ReturnType<typeof svg>,
      state: MarkState,
      { variant = "agent", news = false, beat = "t", playful = 0 } = {}
    ) {
      const mark = new Animator(drawn.svg, variant as "agent" | "logo")
      mark.set({ state, playful, news, beat })
      return {
        mark,
        set: (state: MarkState) => mark.set({ state, playful, news, beat }),
      }
    },
    /** Whether the clock asked for a tick. */
    ticking: () => asked.length > 0,
    /** Runs the ticks asked for, a frame apart, at most `most` of them:
     * how many ran. */
    run(most: number) {
      let ran = 0
      while (asked.length && ran < most) {
        vi.advanceTimersByTime(16)
        for (const run of asked.splice(0)) run(performance.now())
        ran++
      }
      return ran
    },
    /** The marks `entries` name come into view, or leave it. */
    seen: (...entries: [ReturnType<typeof svg>, boolean][]) =>
      seen(
        entries.map(([drawn, isIntersecting]) => ({
          target: drawn.svg,
          isIntersecting,
        }))
      ),
    /** The Person turns all motion off, or back on. */
    still(on: boolean) {
      if (on) html.add("data-still")
      else html.delete("data-still")
      changed()
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ADR 0099, decision 4: a mark drawn for the first time starts in its look,
// mid-rhythm, as if it had been there.
test("a first draw plays no news: the mark starts in its look, and its loops are marks.css's", async () => {
  const time = await motion()
  // Each a Thread of its own.
  for (const state of STATES) {
    const drawn = svg()
    const { mark } = time.mark(drawn, state, { beat: state })
    expect(time.ticking(), state).toBe(false)
    expect(drawn.attributes()["data-news"], state).toBeUndefined()
    expect(drawn.attributes()["data-loop"], state).toBe(
      LOOPED[state] ? state : undefined
    )
    expect(drawn.attributes("[data-body]").d, state).toBe(outlineOf(state))
    mark.dispose()
  }
})

test("a toast's call is news as it is first drawn: done flips and woke arrives, the rest start in their look", async () => {
  const time = await motion()
  const done = svg()
  time.mark(done, "done", { news: true })
  time.run(1)
  expect(done.attributes()["data-news"]).toBe("flip")
  const asking = svg()
  time.mark(asking, "asking", { news: true })
  expect(asking.attributes()["data-news"]).toBeUndefined()
  expect(asking.attributes()["data-loop"]).toBe("asking")
})

test("news hands back to the keyframes: it plays on the clock for its length, then the clock stops and the loops take over", async () => {
  const time = await motion()
  const drawn = svg()
  const { set } = time.mark(drawn, "idle")
  expect(time.ticking()).toBe(false)
  // A new shape leaps into it.
  set("running")
  expect(time.ticking()).toBe(true)
  time.run(1)
  expect(drawn.attributes()["data-news"]).toBe("leap")
  // For 0.6 s, a frame apart, then no more.
  expect(time.run(1000)).toBeLessThan(45)
  expect(time.ticking()).toBe(false)
  const own = drawn.attributes()
  expect(own["data-news"]).toBeUndefined()
  expect(own["data-loop"]).toBe("running")
  expect(own["--mark-phase"]).toMatch(/^-\d+\.\d{3}s$/)
  // Its last drawing is its look between moves, what marks.css moves.
  expect(drawn.attributes("[data-body]").d).toBe(outlineOf("running"))
  expect(turnsOf(drawn)).toBe(
    "translate(0.00 0.00) rotate(-8.00 54 45) translate(76 45) scale(1.00 1.00) translate(-76 -45) rotate(0.00 76 22.5)"
  )
  // The same shape blends; done flips.
  set("thinking")
  time.run(1)
  expect(drawn.attributes()["data-news"]).toBe("blend")
  time.run(1000)
  set("done")
  time.run(1)
  expect(drawn.attributes()["data-news"]).toBe("flip")
  time.run(1000)
  expect(time.ticking()).toBe(false)
  expect(drawn.attributes()["data-loop"]).toBe("done")
})

test("woke arrives asleep, stretches, then rings", async () => {
  const time = await motion()
  const drawn = svg()
  const { set } = time.mark(drawn, "later")
  set("woke")
  const stages: (string | undefined)[] = []
  while (time.ticking()) {
    time.run(1)
    const stage = drawn.attributes()["data-news"]
    if (stage !== stages.at(-1)) stages.push(stage)
  }
  expect(stages).toEqual(["asleep", "stretch", undefined])
  expect(drawn.attributes()["data-loop"]).toBe("woke")
  expect(drawn.attributes("[data-bells]").opacity).toBe("1.00")
})

test("one Thread keeps one rhythm wherever its mark shows, and each Thread its own", async () => {
  const time = await motion()
  const a = svg()
  time.mark(a, "idle", { beat: "t1" })
  // Drawn a second later, the same Thread's mark starts its loops a second
  // further in, so the two move as one.
  vi.advanceTimersByTime(1000)
  const b = svg()
  time.mark(b, "idle", { beat: "t1" })
  expect(phaseIn(a) - phaseIn(b)).toBeCloseTo(1, 2)
  const other = svg()
  time.mark(other, "idle", { beat: "t2" })
  expect(Math.abs(phaseIn(other) - phaseIn(b))).toBeGreaterThan(0.01)
})

// Until one keyed list keeps a row's node (ADR 0098, step 5), the sidebar
// draws a Thread's row afresh as it changes part: Working to Your turn.
test("a Thread's mark drawn again just as its last went is that mark moved: a new look is news, the same look none", async () => {
  const time = await motion()
  const { mark: working } = time.mark(svg(), "running", { beat: "t1" })
  working.dispose()
  const done = svg()
  time.mark(done, "done", { beat: "t1" })
  time.run(1)
  expect(done.attributes()["data-news"]).toBe("flip")
  time.run(1000)
  expect(done.attributes()["data-loop"]).toBe("done")
  // The same look again, as the sidebar is hidden and shown, or another
  // Thread's, is no news.
  const { mark: asking } = time.mark(svg(), "asking", { beat: "t2" })
  asking.dispose()
  const again = svg()
  time.mark(again, "asking", { beat: "t2" })
  const another = svg()
  time.mark(another, "failed", { beat: "t3" })
  expect(time.ticking()).toBe(false)
  // Nor is a mark drawn a while after its last went.
  const { mark: failed } = time.mark(svg(), "failed", { beat: "t4" })
  failed.dispose()
  vi.advanceTimersByTime(1500)
  const late = svg()
  time.mark(late, "done", { beat: "t4" })
  expect(time.ticking()).toBe(false)
  expect(late.attributes()["data-loop"]).toBe("done")
})

test("out of view its loops wait, and come back on its rhythm; news unseen skips to its end", async () => {
  const time = await motion()
  const drawn = svg()
  const { set } = time.mark(drawn, "idle")
  const before = phaseIn(drawn)
  time.seen([drawn, false])
  expect(drawn.attributes()["data-paused"]).toBe("")
  vi.advanceTimersByTime(5000)
  time.seen([drawn, true])
  expect(drawn.attributes()["data-paused"]).toBeUndefined()
  // Its loops start over, five seconds further on.
  expect(drawn.animations[0]!.currentTime).toBe(0)
  expect(before - phaseIn(drawn)).toBeCloseTo(5, 2)
  time.seen([drawn, false])
  set("asking")
  expect(time.run(1000)).toBe(1)
  expect(drawn.attributes()["data-news"]).toBeUndefined()
  expect(drawn.attributes()["data-loop"]).toBe("asking")
})

// ADR 0099, decision 8.
test("with no motion asked for, a mark draws its look's still pose, and no loop plays", async () => {
  const time = await motion({ still: true })
  const drawn = svg()
  const { set } = time.mark(drawn, "failed")
  time.run(1000)
  expect(time.ticking()).toBe(false)
  expect(drawn.attributes("[data-body]").d).toBe(outlineOf("failed"))
  const still = /<g transform="([^"]+)"/.exec(stillMark("failed", colors))![1]
  expect(turnsOf(drawn)).toBe(still)
  expect(drawn.attributes()["data-loop"]).toBeUndefined()
  // A new look is no news.
  set("woke")
  expect(time.ticking()).toBe(false)
  expect(drawn.attributes("[data-bells]").opacity).toBe("1.00")
  expect(drawn.attributes()["data-loop"]).toBeUndefined()
  // Motion back on, its loops play.
  time.still(false)
  expect(drawn.attributes()["data-loop"]).toBe("woke")
  time.still(true)
  expect(drawn.attributes()["data-loop"]).toBeUndefined()
  // Offline snores still, its zz where a still mark draws them; with
  // motion on, they stand unseen where the SVG drew them, for marks.css's
  // snores to rise from.
  set("offline")
  expect(drawn.attributes("[data-zz]").opacity).toBe("1.00")
  expect(snoresIn(drawn)).toEqual(snoresIn(stillMark("offline", colors)))
  time.still(false)
  expect(drawn.attributes()["data-loop"]).toBe("offline")
  expect(snoresIn(drawn)).toEqual(
    snoresIn(
      renderToStaticMarkup(<BandaMark variant="agent" state="offline" />)
    )
  )
})

test("with less motion asked for, a mark draws its look's still pose", async () => {
  const time = await motion({ reduced: true })
  const drawn = svg()
  const { set } = time.mark(drawn, "asking")
  set("done")
  expect(time.ticking()).toBe(false)
  expect(drawn.attributes()["data-loop"]).toBeUndefined()
  expect(drawn.attributes("[data-glyph]").d).toBe(
    /<path d="([^"]+)" fill="none"/.exec(stillMark("done", colors))![1]
  )
  // Offline snores still, its zz where a still mark draws them.
  set("offline")
  expect(time.ticking()).toBe(false)
  expect(drawn.attributes("[data-zz]").opacity).toBe("1.00")
  expect(snoresIn(drawn)).toEqual(snoresIn(stillMark("offline", colors)))
})

test("the logo at rest wakes for its trick by a timer, not the clock", async () => {
  const time = await motion()
  const { mark: logo } = time.mark(svg(), "rest", {
    variant: "logo",
    playful: 2,
  })
  time.run(1000)
  expect(time.ticking()).toBe(false)
  // Its trick comes within 1.25 times `playful` seconds.
  vi.advanceTimersByTime(2500)
  expect(time.ticking()).toBe(true)
  // It wakes, plays, and is still again.
  expect(time.run(1000)).toBeGreaterThan(60)
  expect(time.ticking()).toBe(false)
  // Gone, it wakes no more.
  logo.dispose()
  vi.advanceTimersByTime(5000)
  expect(time.ticking()).toBe(false)
})

test("the logo at rest sets its timer once, however often another mark ticks", async () => {
  const time = await motion()
  const { mark: logo } = time.mark(svg(), "rest", {
    variant: "logo",
    playful: 30,
  })
  time.run(1000)
  const timers = vi.spyOn(globalThis, "setTimeout")
  // A Thread's news beside it ticks, and the logo, still, with it.
  const { mark, set } = time.mark(svg(), "running")
  set("asking")
  expect(time.run(300)).toBeGreaterThan(20)
  expect(timers).not.toHaveBeenCalled()
  mark.dispose()
  logo.dispose()
})
