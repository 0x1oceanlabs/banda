// The Thread in the painting's bubble: an Agent asks, the Person answers,
// it works, it is done; the lead of the gang takes each state as it
// goes. It plays only while the painting is in sight.
import { setState } from "./gang"
import { reduced, whileVisible } from "./mark"
import type { GangState } from "./paint"

interface Step {
  state: GangState
  who: string
  msg: string
  answer?: string
  ms: number
}

const SCRIPT: Step[] = [
  {
    state: "asks",
    who: "Agent · Claude Code · asks",
    msg: "Tests pass. Allow <code>pnpm publish</code>?",
    answer: "Allow.",
    ms: 5200,
  },
  {
    state: "working",
    who: "Agent · working",
    msg: '<span class="work">Ran 1 command · publishing</span>',
    ms: 3600,
  },
  {
    state: "done",
    who: "Agent · done",
    msg: "Published. The notes are in CHANGELOG.md.",
    ms: 4200,
  },
  {
    state: "asks",
    who: "Agent · Codex · asks",
    msg: "Two ways to fix the flaky test. Which one?",
    answer: "The second.",
    ms: 5200,
  },
  {
    state: "working",
    who: "Agent · working",
    msg: '<span class="work">Edited 2 files +38 −9</span>',
    ms: 3600,
  },
  {
    state: "done",
    who: "Agent · done",
    msg: "Fixed. All tests pass.",
    ms: 4200,
  },
]

const TONE: Record<GangState, string> = {
  calm: "var(--gang-calm)",
  working: "var(--gang-working)",
  asks: "var(--gang-asks)",
  failed: "var(--gang-failed)",
  done: "var(--gang-done)",
  woke: "var(--gang-woke)",
  later: "var(--gang-later)",
}

export function playBubble(canvas: HTMLElement) {
  const $ = (name: string) =>
    canvas.querySelector<HTMLElement>(`[data-say-${name}]`)!
  const lines = $("lines")
  const who = $("who")
  const msg = $("msg")
  const dot = $("dot")
  const you = $("you")
  const answer = $("answer")
  const lead = canvas.querySelector<HTMLElement>(".lead > .ch")!

  let step = 0
  let timers: number[] = []
  const later = (fn: () => void, ms: number) =>
    timers.push(window.setTimeout(fn, ms))

  function show(i: number) {
    const s = SCRIPT[i]
    lines.classList.add("fade")
    later(() => {
      who.textContent = s.who
      msg.innerHTML = s.msg
      dot.style.background = TONE[s.state]
      dot.style.borderRadius = s.state === "working" ? "50%" : "2px"
      lines.classList.remove("fade")
      you.classList.remove("on")
      if (s.answer) {
        answer.textContent = s.answer
        later(() => you.classList.add("on"), 2600)
      }
      setState(lead, s.state)
    }, 280)
    later(() => show((step = (i + 1) % SCRIPT.length)), s.ms)
  }

  if (reduced) return
  whileVisible(
    canvas,
    () => later(() => show((step = (step + 1) % SCRIPT.length)), 4200),
    () => {
      timers.forEach(clearTimeout)
      timers = []
    }
  )
}
