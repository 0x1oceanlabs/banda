// @vitest-environment happy-dom
/**
 * Every kind of Pane that opens on another machine (`PaneKind.elsewhere`)
 * passes the Pane kit (ADR 0106, laws 5 and 6;
 * `@banda/ui/testing/conformance`): mounted with a recording session to
 * arc, live, away before an act, away with an act in flight, back with a
 * new `boot`, and on an older build of arc that lacks its methods, nothing
 * it does hangs without words, and the one pill is the Frame's. The kinds
 * listed in `PENDING` wait for the steps of ADR 0106's plan named beside
 * them; none joins the list, and a kind leaves it once it passes. A kind
 * that comes to open elsewhere passes as it does: the terminal, in 1b.
 */
import type { JsonValue } from "@banda/contract"
import { type Conformance, conformance } from "@banda/ui/testing/conformance"
import { expect, test } from "vitest"
import { modules } from "./modules"
import { windowModule } from "./registry"

/** The kinds that opened elsewhere before the kit came: only these may
 * wait for it. */
const BEFORE_THE_KIT = ["agents.thread"]

/** The kinds that open elsewhere and do not pass the kit yet, each with
 * the steps that bring it there. */
const PENDING: Record<string, string> = {
  // Its calls and streams wait while arc is away until 0′, and its
  // `args.host` branches and its reaches past its handles go one per
  // slice, the last in 4d. It does not mount in the kit yet either: the
  // kit's page has no CSS highlights, which its Find marks with (#1250).
  "agents.thread": "0′, then its slices to 4d",
}

/**
 * What the kit is given of each kind, beside the kind: what its engine
 * part answers, its args, the gestures to play. By default a kind is
 * answered nothing and each button it draws is clicked; the step that
 * makes a kind open elsewhere gives it here what it needs, as the
 * terminal's keys in 1b.
 */
const GIVEN: Record<
  string,
  Omit<Conformance<{ [key: string]: JsonValue }>, "kind">
> = {}

const elsewhere = [...modules, windowModule]
  .flatMap((module) => module.panes ?? [])
  .filter((kind) => kind.elsewhere)

test("only kinds that open elsewhere wait for the kit, or are given to it, each for its steps", () => {
  const ids = elsewhere.map(({ kind }) => kind)
  expect(ids).toContain("agents.thread")
  for (const [kind, steps] of Object.entries(PENDING)) {
    expect(ids, kind).toContain(kind)
    expect(
      BEFORE_THE_KIT,
      `${kind} came after the kit, so passes it`
    ).toContain(kind)
    expect(steps, kind).toMatch(/\S/)
  }
  for (const kind of Object.keys(GIVEN)) expect(ids, kind).toContain(kind)
})

test("each kind that opens elsewhere, but those waiting, passes the kit", async () => {
  const found: string[] = []
  for (const kind of elsewhere.filter((one) => !(one.kind in PENDING)))
    found.push(...(await conformance({ kind, ...GIVEN[kind.kind] })))
  expect(found).toEqual([])
})

test("a kind that waits for the kit does not pass it yet, else it leaves the list", async () => {
  for (const kind of elsewhere.filter((one) => one.kind in PENDING))
    expect(
      await conformance({ kind, ...GIVEN[kind.kind] }),
      `${kind.kind} passes the kit: take it off PENDING`
    ).not.toEqual([])
})
