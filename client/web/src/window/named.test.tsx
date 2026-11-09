import type { ProjectId } from "@banda/contract"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, test, vi } from "vitest"
import {
  HostsContext,
  type HostState,
  KeptHosts,
  type Shown,
  shownOf,
  unseen,
} from "@banda/core/react"
import { MachinePill, machineHeader } from "./named"

afterEach(() => {
  vi.useRealTimers()
})

const MINUTE = 60_000

/** arc as the Window shows it, `state` since `at`: a server. */
const shown = (state: HostState, at = 0): Shown => ({
  ...shownOf(undefined, state, at),
  named: { name: "arc", icon: "server" },
})

/** Markup as it reads. */
const read = (markup: string) =>
  markup
    .split(/<[^>]*>/)
    .join("")
    .replaceAll("&#x27;", "'")

/** The pill of a Pane on arc, drawn at `now`: its markup, and its words
 * as they read. */
function pill(arc: Shown, now = 0) {
  vi.useFakeTimers({ now })
  const markup = renderToStaticMarkup(
    <MachinePill shown={arc} onStart={() => {}} />
  )
  return { markup, words: read(markup) }
}

const ICON = 'data-machine-icon="server"'

test("away, the pill has the machine's icon and says for how long, as its label does, outside what is said as it changes", () => {
  const away: HostState = {
    name: "arc",
    ssh: "arc",
    state: "away",
    why: "ssh ended",
  }
  const since = 10 * MINUTE
  const now = pill(shown(away, since), since + 30_000)
  expect(now.markup).toContain(ICON)
  expect(now.words).toBe("arc is away")
  const later = pill(shown(away, since), since + 2 * MINUTE)
  expect(later.words).toBe("arc is away · 2 min")
  expect(pill(shown(away, since), since + 90 * MINUTE).words).toBe(
    "arc is away · 1 h"
  )
  // A screen reader hears that it is away, not each minute after.
  expect(later.markup).toContain('<span role="status">arc is away</span>')
  // Nothing to press: the pointer goes to the Pane under it.
  expect(later.markup).not.toContain("<button")
  expect(later.markup).not.toContain("pointer-events-auto")
})

test("stopped, the pill has Start, and takes the pointer only then", () => {
  const stopped = pill(shown({ name: "arc", ssh: "arc", state: "stopped" }))
  expect(stopped.markup).toContain(ICON)
  expect(stopped.words).toBe("Banda is stopped on arc·Start")
  expect(stopped.markup).toMatch(/<button type="button"[^>]*>.*Start<\/button>/)
  expect(stopped.markup).toContain("pointer-events-auto")
})

test("connecting, Tailscale's sign-in and a refusal keep their words, with the icon and no action", () => {
  const states: [HostState, string][] = [
    [{ name: "arc", ssh: "arc", state: "connecting" }, "Connecting to arc"],
    [
      {
        name: "arc",
        ssh: "arc",
        state: "signin",
        url: "https://login.tailscale.com/x",
      },
      "Sign in to Tailscale to reach arc",
    ],
    [
      { name: "arc", ssh: "arc", state: "refused", why: "an older window" },
      "arc: an older window",
    ],
  ]
  for (const [state, words] of states) {
    const one = pill(shown(state))
    expect(one.words).toBe(words)
    expect(one.markup).toContain(ICON)
    expect(one.markup).not.toContain("<button")
    expect(one.markup).not.toContain("pointer-events-auto")
  }
})

test("live, on its build or another, there is no pill: another build waits for Update arc (#775)", () => {
  const live = (build: string): HostState => ({
    name: "arc",
    ssh: "arc",
    state: "live",
    build,
    version: "0.1.0-dev.421",
    own: { build: "abc123", version: "0.1.0-dev.421" },
  })
  expect(pill(shown(live("abc123"))).markup).toBe("")
  expect(pill(shown(live("def456"))).markup).toBe("")
})

test("the Window fills the pill of a Pane by the host its args name, as the Window shows it; none for a Pane on no host", () => {
  const kept = new KeptHosts(
    {
      follow: () => undefined,
      engine: () => Promise.reject(new Error("not here")),
      start: () => undefined,
    },
    { seen: unseen, follow: () => () => undefined }
  )
  kept.take([{ name: "arc", ssh: "arc", state: "stopped" }])
  const { Fill } = machineHeader
  const fill = (pane: { thread: string; host?: string }) =>
    read(
      renderToStaticMarkup(
        <HostsContext value={kept}>
          <Fill
            at="pill"
            project={"r1" as ProjectId}
            pane={{ kind: "agents.thread", args: pane }}
            listed={undefined}
          />
        </HostsContext>
      )
    )
  expect(fill({ thread: "t1", host: "arc" })).toBe(
    "Banda is stopped on arc·Start"
  )
  expect(fill({ thread: "t1" })).toBe("")
})
