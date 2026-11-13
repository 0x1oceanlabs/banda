// The desk window's loop: a few minutes of real work, folded into
// thirteen seconds. One Agent finishes, a sub-agent fails and stays in
// its Thread, another asks and its card goes to Your turn, the Person
// allows once, and the work goes on. It plays only while it is seen.
import { markOf, reduced, whileVisible, type MarkOptions } from "./mark"
import { satelliteSvg, type SatelliteState } from "./satellite"

type Group = "turn" | "work" | "later"
type Order = Record<Group, string[]>

export function playWindow(win: HTMLElement) {
  const q = <T extends Element = HTMLElement>(sel: string) =>
    win.querySelector<T>(sel)!
  const items = new Map(
    [...win.querySelectorAll<HTMLElement>(".it[data-k]")].map((el) => [
      el.dataset.k!,
      el,
    ])
  )
  const lists = {
    turn: q('[data-list="turn"]'),
    work: q('[data-list="work"]'),
    later: q('[data-list="later"]'),
  }
  const term = q("[data-term]")
  const ask = q("[data-ask]")
  const opt = q("[data-opt]")
  const toggle = q("[data-btog]")
  const fold = q("[data-fold]")
  const clock = q("[data-clock]")
  const tmark = () => markOf(q("[data-tmark]"))
  const wlogo = () => markOf(q("[data-wlogo]"))

  function look(
    key: string,
    options: MarkOptions,
    line?: string,
    time?: string
  ) {
    const el = items.get(key)!
    el.dataset.look = options.state
    markOf(el.querySelector(".mk"))?.set(options)
    if (line != null) el.querySelector(".it-2")!.innerHTML = line
    if (time != null) el.querySelector(".tm")!.textContent = time
  }

  // FLIP: the cards move to where they now belong.
  function place(order: Order) {
    const before = new Map<string, number>()
    items.forEach((el, k) => before.set(k, el.getBoundingClientRect().top))
    for (const group of ["turn", "work", "later"] as Group[]) {
      for (const k of order[group]) {
        const el = items.get(k)!
        el.classList.toggle("card", group === "turn")
        el.classList.toggle("later", group === "later")
        el.classList.toggle("sel", k === "move")
        lists[group].appendChild(el)
      }
    }
    q("[data-n-turn]").textContent = String(order.turn.length)
    q("[data-n-work]").textContent = String(order.work.length)
    q("[data-n-work2]").textContent = String(order.work.length)
    if (reduced) return
    const scale = win.getBoundingClientRect().width / win.offsetWidth || 1
    items.forEach((el, k) => {
      const dy = (before.get(k)! - el.getBoundingClientRect().top) / scale
      if (Math.abs(dy) > 1)
        el.animate(
          [{ transform: `translateY(${dy}px)` }, { transform: "none" }],
          { duration: 600, easing: "cubic-bezier(.2,.7,.2,1)" }
        )
    })
  }

  function folded(
    read: number,
    ran: number,
    edited: number,
    add: number,
    rem: number
  ) {
    fold.innerHTML = `Read ${read} files, ran ${ran} command${ran > 1 ? "s" : ""}, edited ${edited} file${edited > 1 ? "s" : ""} <span class="add">+${add}</span> <span class="rem">−${rem}</span>`
  }

  function sub(id: string, state: SatelliteState, html: string, time?: string) {
    const row = q(`[data-sub="${id}"]`)
    row.dataset.s = state
    row.querySelector(".sat")!.innerHTML = satelliteSvg(state)
    row.querySelector(".sa")!.innerHTML = html
    if (time) row.querySelector(".stime")!.textContent = time
    const count = { working: 0, asks: 0, failed: 0, done: 0 }
    let dots = ""
    win.querySelectorAll<HTMLElement>("[data-sub]").forEach((r) => {
      const s = r.dataset.s as SatelliteState
      count[s]++
      dots += satelliteSvg(s, 8)
    })
    q("[data-sats]").innerHTML = dots
    const parts = []
    if (count.working) parts.push(`${count.working} working`)
    if (count.done) parts.push(`${count.done} done`)
    if (count.asks) parts.push(`<span class="a">${count.asks} asks</span>`)
    if (count.failed)
      parts.push(`<span class="f">${count.failed} failed</span>`)
    q("[data-ssum]").innerHTML = `· ${parts.join(" · ")}`
  }

  function line(html: string) {
    const div = document.createElement("div")
    div.className = reduced ? "tline" : "tline new"
    div.innerHTML = html
    term.insertBefore(div, term.lastElementChild)
    while (term.children.length > 14) term.firstElementChild!.remove()
  }

  const working3: SatelliteState[] = ["working", "working", "working"]
  const oneFailed: SatelliteState[] = ["working", "failed", "working"]

  function start() {
    look(
      "move",
      { state: "working", doing: "subagents", satellites: working3 },
      "<b>Working</b> 3 sub-agents",
      "1m"
    )
    look("fix", { state: "working", doing: "execute" }, undefined, "9m")
    look("inv", { state: "woke" })
    place({
      turn: ["inv"],
      work: ["move", "fix", "hyp", "aud", "lan", "rec"],
      later: ["tah"],
    })
    tmark()?.set({ state: "working", doing: "subagents", satellites: working3 })
    wlogo()?.set({ state: "woke" })
    sub(
      "s1",
      "working",
      'Reading <span class="mono">client/web/src/</span>…',
      "4m"
    )
    sub("s2", "working", "Running settings.test.ts", "5m")
    sub("s3", "working", "Reading sidebar.toml", "1m")
    folded(4, 2, 1, 21, 4)
    ask.classList.remove("open")
    opt.classList.remove("press")
    toggle.classList.remove("on")
  }

  const steps: [number, () => void][] = [
    // An Agent finishes: its card goes to Your turn.
    [
      450,
      () => {
        look("fix", { state: "done", news: true }, undefined, "now")
        place({
          turn: ["inv", "fix"],
          work: ["move", "hyp", "aud", "lan", "rec"],
          later: ["tah"],
        })
        line(
          '<span class="t">12:41:07</span> <span class="b">[vite]</span> hmr update /src/window/boot.ts'
        )
      },
    ],
    // A sub-agent fails: it stays in its Thread, the card does not move.
    [
      900,
      () => {
        sub(
          "s2",
          "failed",
          '<span class="tag">Failed</span>2 tests fail in settings.test.ts',
          "5m"
        )
        tmark()?.set({
          state: "working",
          doing: "subagents",
          satellites: oneFailed,
        })
        look("move", {
          state: "working",
          doing: "subagents",
          satellites: oneFailed,
        })
        folded(6, 3, 2, 38, 9)
      },
    ],
    // Another asks: the Thread asks, its card goes to Your turn.
    [
      1350,
      () => {
        sub("s3", "asks", "<b>Asks:</b> Allow pnpm vitest sidebar", "now")
        tmark()?.set({ state: "asks" })
        look(
          "move",
          { state: "asks" },
          "<b>Asks</b> Reviewer: allow pnpm vitest sidebar",
          "now"
        )
        place({
          turn: ["inv", "fix", "move"],
          work: ["hyp", "aud", "lan", "rec"],
          later: ["tah"],
        })
        ask.classList.add("open")
        wlogo()?.set({ state: "asks" })
      },
    ],
    [7600, () => opt.classList.add("press")],
    // The Person answers: Allow once.
    [
      8100,
      () => {
        ask.classList.remove("open")
        sub("s3", "working", "Running pnpm vitest sidebar", "now")
        tmark()?.set({
          state: "working",
          doing: "subagents",
          satellites: oneFailed,
        })
        look(
          "move",
          { state: "working", doing: "subagents", satellites: oneFailed },
          "<b>Working</b> 3 sub-agents",
          "now"
        )
        place({
          turn: ["inv", "fix"],
          work: ["move", "hyp", "aud", "lan", "rec"],
          later: ["tah"],
        })
        wlogo()?.set({ state: "woke" })
        line(
          '<span class="c">$ pnpm vitest sidebar</span> <span class="t">· Reviewer</span>'
        )
      },
    ],
    [
      9800,
      () => {
        sub("s3", "done", "Schema reviewed · 1 note", "now")
        line(
          '<span class="g">&nbsp;✓</span> sidebar/toml.test.ts <span class="t">(7)</span>'
        )
        toggle.classList.add("on")
      },
    ],
    [12600, () => opt.classList.remove("press")],
  ]
  const LOOP = 13600

  let timers: number[] = []
  let ticking = 0
  let seconds = 400
  function run() {
    start()
    timers = steps.map(([ms, fn]) => window.setTimeout(fn, ms))
    timers.push(window.setTimeout(run, LOOP))
  }

  if (reduced) {
    // A still: the moment the Agent asks.
    start()
    steps.slice(0, 3).forEach(([, fn]) => fn())
    return
  }
  whileVisible(
    win,
    () => {
      run()
      ticking = window.setInterval(() => {
        seconds++
        const s = seconds % 60
        clock.textContent = `${Math.floor(seconds / 60)}m ${s < 10 ? "0" : ""}${s}s`
      }, 1000)
    },
    () => {
      timers.forEach(clearTimeout)
      timers = []
      clearInterval(ticking)
    }
  )
}
