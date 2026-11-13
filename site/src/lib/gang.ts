// The gang on the wall comes alive: the eyes follow the pointer, blink
// now and then, and a character can change its state. One loop moves
// every pupil, and only while some of the gang is on screen.
import { EYE, VIEW, eyeKind, type GangState } from "./paint"

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches

interface Member {
  el: HTMLElement
  eyes: SVGSVGElement | null
  pupils: SVGGElement | null
  gaze: string
  ox: number
  oy: number
}

/** Sets a painted character's state: its body, its eyes and motion. */
export function setState(el: HTMLElement, state: GangState) {
  el.dataset.state = state
  el.dataset.eyes = eyeKind(state)
  el.querySelectorAll<SVGSVGElement>(".ch-body").forEach((layer) => {
    layer.classList.toggle("on", layer.dataset.s === state)
  })
}

export function liveGang(headline: Element | null) {
  const members: Member[] = [
    ...document.querySelectorAll<HTMLElement>(".ch"),
  ].map((el) => ({
    el,
    eyes: el.querySelector<SVGSVGElement>(".ch-eyes"),
    pupils: el.querySelector<SVGGElement>(".pupils"),
    gaze: el.dataset.gaze ?? "idle",
    ox: 0,
    oy: 0,
  }))
  const seen = new Set<Member>()
  const byEl = new Map(members.map((m) => [m.el, m]))

  let pointer: { x: number; y: number } | null = null
  let moved = 0
  addEventListener(
    "pointermove",
    (e) => {
      pointer = { x: e.clientX, y: e.clientY }
      moved = performance.now()
    },
    { passive: true }
  )
  document.addEventListener("pointerleave", () => (pointer = null))

  const idle = { x: 0, y: 0, at: 0 }
  const reach = EYE.r - EYE.pupil - 5

  function aim(m: Member, now: number): [number, number] {
    // At work, the eyes run along lines, as when reading.
    if (m.el.dataset.state === "working") {
      const t = now / 700
      return [Math.sin(t) * 0.9 * reach, 0.45 * reach]
    }
    let target = pointer && now - moved < 6000 ? pointer : null
    if (!target && m.gaze === "headline" && headline) {
      const b = headline.getBoundingClientRect()
      target = { x: b.left + b.width * 0.45, y: b.top + b.height * 0.5 }
    }
    if (!target) return [idle.x * reach, idle.y * reach]
    const box = m.eyes!.getBoundingClientRect()
    const cx = box.left + box.width / 2
    const cy = box.top + ((EYE.y - VIEW.y) / VIEW.h) * box.height
    const dx = target.x - cx
    const dy = target.y - cy
    const d = Math.hypot(dx, dy) || 1
    const k = Math.min(1, d / 260)
    return [(dx / d) * reach * k, (dy / d) * reach * k]
  }

  let frame = 0
  function tick(now: number) {
    frame = 0
    if (now - idle.at > 2600) {
      idle.at = now
      idle.x = (Math.random() - 0.5) * 1.2
      idle.y = (Math.random() - 0.4) * 0.8
    }
    for (const m of seen) {
      if (!m.pupils || m.el.dataset.eyes !== "open") continue
      const [tx, ty] = aim(m, now)
      const ease = reduced ? 1 : 0.14
      m.ox += (tx - m.ox) * ease
      m.oy += (ty - m.oy) * ease
      m.pupils.setAttribute(
        "transform",
        `translate(${m.ox.toFixed(2)} ${m.oy.toFixed(2)})`
      )
    }
    if (seen.size && !reduced) frame = requestAnimationFrame(tick)
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const m = byEl.get(entry.target as HTMLElement)
        if (!m) continue
        if (entry.isIntersecting) seen.add(m)
        else seen.delete(m)
      }
      if (seen.size && !frame) frame = requestAnimationFrame(tick)
    },
    { rootMargin: "80px" }
  )
  members.forEach((m) => io.observe(m.el))

  // Blinks, now and then, by one of those in sight.
  if (!reduced)
    setInterval(() => {
      const open = [...seen].filter((m) => m.el.dataset.eyes === "open")
      const m = open[Math.floor(Math.random() * open.length)]
      if (!m) return
      m.el.classList.add("blink")
      setTimeout(() => m.el.classList.remove("blink"), 180)
    }, 900)
}
