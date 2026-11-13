// The dive from the wall onto the desk, driven by the scroll. The stage
// is sticky; how far the reader scrolled through its section is the
// progress, and each layer reads its own stretch of it. Scroll events
// only ask for a frame; the frame writes transforms and opacities.
import { reduced } from "./mark"

/** The window's own size, as DeskWindow draws it. */
const WIDTH = 1200
const HEIGHT = 740
/** On a phone the window shows its left part: the sidebar and a Thread. */
const NARROW = 560

const clamp = (t: number) => Math.max(0, Math.min(1, t))
const span = (p: number, from: number, to: number) =>
  clamp((p - from) / (to - from))
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

export function dive(section: HTMLElement) {
  const $ = (sel: string) => section.querySelector<HTMLElement>(sel)!
  const flood = $("[data-flood]")
  const glow = $("[data-glow]")
  const head = $("[data-head]")
  const bench = $("[data-bench]")
  const tilt = $("[data-tilt]")
  const reflect = $(".reflect")
  const eyes = $("[data-eyes]")
  const look = eyes.querySelector(".pupils")!

  let scale = 0.6
  let narrow = false

  function size() {
    narrow = innerWidth < 720
    tilt.toggleAttribute("data-narrow", narrow)
    // On a phone the bench runs to the screen's right edge.
    const width = bench.clientWidth - (narrow ? 32 : 0)
    const height = bench.clientHeight
    scale = narrow
      ? Math.min(width / NARROW, (height - 8) / HEIGHT)
      : Math.min(1.1, width / WIDTH, (height - 8) / HEIGHT)
    tilt.style.setProperty("--s", scale.toFixed(4))
  }

  const stage = $(".stage")
  const edge = $(".edge")

  /** The dark paint's front, from the top of the screen to past its
   * bottom. It starts while the cast is still in sight, so the paint
   * runs down over the wall the reader just looked at. */
  function pour() {
    const top = section.getBoundingClientRect().top
    const start = innerHeight * 0.9
    const span = section.offsetHeight - innerHeight
    const f = easeInOut(clamp((start - top) / (start + span * 0.06)))
    const front = f * (innerHeight + edge.clientHeight)
    // Never below its rest at the stage's top: once the stage scrolls
    // away, the paint goes with it.
    const shift = Math.min(
      0,
      front - stage.getBoundingClientRect().top - flood.offsetHeight
    )
    flood.style.transform = `translate3d(0, ${shift.toFixed(1)}px, 0)`
    return f
  }

  function draw(p: number) {
    // 1. The dark paint floods down over the wall.
    const f = pour()
    // The eyes left in the dark open once it is dark, look up at the
    //    reader, and close as the desk lights up.
    const open = span(f, 0.8, 1) * (1 - span(p, 0.14, 0.22))
    eyes.style.opacity = open.toFixed(3)
    eyes.style.transform = `scale(1, ${Math.max(0.08, open).toFixed(3)})`
    look.setAttribute(
      "transform",
      `translate(${(6 - 12 * span(p, 0.04, 0.14)).toFixed(1)} -6)`
    )
    // 2. The glow comes up where the cadmium disc was. The paint shows
    //    only while it pours: before, it waits above the screen; after,
    //    the glow covers it and its edge would hang past the stage.
    const g = easeOut(span(p, 0.12, 0.34))
    glow.style.opacity = g.toFixed(3)
    glow.style.transform = `scale(${(1.25 - 0.25 * g).toFixed(4)})`
    flood.style.visibility = f <= 0 || g >= 1 ? "hidden" : ""
    // 3. The headline.
    const h = easeOut(span(p, 0.2, 0.34))
    head.style.opacity = h.toFixed(3)
    head.style.transform = `translate3d(0, ${(28 * (1 - h)).toFixed(1)}px, 0)`
    // 4. The window rises, lying on the desk, and straightens.
    const w = easeOut(span(p, 0.24, 0.8))
    const rise = (1 - w) * bench.clientHeight * 0.7
    const tiltX = (narrow ? 18 : 34) * (1 - w)
    const s = scale * (0.86 + 0.14 * w)
    const x = narrow ? "" : "translateX(-50%) "
    tilt.style.transform = `${x}translate3d(0, ${rise.toFixed(1)}px, 0) rotateX(${tiltX.toFixed(2)}deg) scale(${s.toFixed(4)})`
    tilt.style.opacity = easeOut(span(p, 0.22, 0.32)).toFixed(3)
    reflect.style.setProperty("--sheen", (0.08 * (1 - w)).toFixed(3))
  }

  function progress() {
    const box = section.getBoundingClientRect()
    return clamp(-box.top / (box.height - innerHeight))
  }

  if (reduced) {
    // A still: the desk, the window straight.
    size()
    draw(1)
    addEventListener("resize", () => {
      size()
      draw(1)
    })
    return
  }

  section.classList.add("live")
  let pending = 0
  const frame = () => {
    pending = 0
    draw(progress())
  }
  const ask = () => {
    if (!pending) pending = requestAnimationFrame(frame)
  }
  // Listen to the scroll only while the section is near.
  new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        addEventListener("scroll", ask, { passive: true })
        ask()
      } else removeEventListener("scroll", ask)
    },
    { rootMargin: "100% 0px" }
  ).observe(section)
  addEventListener("resize", () => {
    size()
    ask()
  })
  size()
  draw(progress())
}
