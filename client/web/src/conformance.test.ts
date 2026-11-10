// @vitest-environment happy-dom
/**
 * Every kind of Pane that opens on another machine (`PaneKind.elsewhere`)
 * passes the Pane kit (ADR 0106, laws 5 and 6;
 * `@banda/ui/testing/conformance`): mounted with a recording session to
 * arc, live, away before an act, away with an act in flight, back with a
 * new `boot`, and on an older build of arc that lacks its methods, nothing
 * it does hangs without words, and the one pill is the Frame's. The kinds listed in
 * `PENDING` wait for the steps of ADR 0106's plan named beside them; none
 * joins the list, and a kind leaves it as its step lands. A kind that comes
 * to open elsewhere passes as it does: the terminal, in step 1b.
 */
import type { JsonValue } from "@banda/contract"
import { type Conformance, conformance } from "@banda/ui/testing/conformance"
import { expect, test } from "vitest"
import { modules } from "./modules"
import { windowModule } from "./registry"

/** The kinds that open elsewhere and do not pass the kit yet, each with
 * the steps that bring it there. */
const PENDING: Record<string, string> = {
  // The kit mounts a Pane by its props alone. The Thread mounts only in
  // the window's contexts, with a Thread of arc's to show, and its acts
  // wait while arc is away until 0′; it is given to the kit as its
  // slices take its reaches and its `args.host` branches, the last in 4c.
  "agents.thread": "0′, then its slices to 4c",
}

/**
 * What the kit is given of each kind, beside the kind: what its engine
 * part answers, its args, the gestures to play. By default a kind is
 * answered nothing and each button it draws is clicked; the step that
 * makes a kind open elsewhere gives it here what it needs.
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
