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
 * that comes to open elsewhere passes as it does: the terminal, in 1b,
 * the Diff, in 2a.
 */
import type { JsonValue } from "@banda/contract"
import type { AnyPaneKind } from "@banda/ui/module"
import { type Conformance, conformance } from "@banda/ui/testing/conformance"
import { createElement } from "react"
import { expect, test } from "vitest"
import { KindsContext } from "./launcher"
import { modules } from "./modules"
import { KINDS, windowModule } from "./registry"

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

/** arc's git for the Diff: one file changed, read at its first event. */
function diffAnswers(method: string): JsonValue | undefined {
  if (method === "git.diff")
    return {
      at: 0,
      files: [{ path: "a.txt", added: 1, removed: 1 }],
      patch:
        "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-one\n+two\n",
      truncated: false,
      base: { name: "main" },
    }
  return method === "git.commits" ? { commits: [] } : undefined
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
> = {
  // New Pane on arc, which runs every App: a click on each kind it offers.
  "window.launcher": { modules: ["agents", "terminal", "files", "git"] },
  // The Diff on arc, on a change of one file: each of its buttons, Stage
  // and Revert among them, but those that only read. Its Unstaged scope,
  // as the one it opens on has no Stage or Revert to play.
  "git.diff": {
    modules: ["git"],
    args: { scope: { kind: "unstaged" }, file: null },
    answers: diffAnswers,
    reads: ["Scope", "Base", "Refresh"],
  },
}

/** Each kind as the Window mounts it: New Pane with the kinds the Window
 * hands it (`PaneMount`), which the kit does not. */
const mounted = (kind: AnyPaneKind): AnyPaneKind =>
  kind.kind === "window.launcher"
    ? {
        ...kind,
        Pane: (props) =>
          createElement(KindsContext, {
            value: KINDS,
            children: createElement(kind.Pane, props),
          }),
      }
    : kind

const elsewhere = [...modules, windowModule]
  .flatMap((module) => module.panes ?? [])
  .filter((kind) => kind.elsewhere)
  .map(mounted)

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
}, 30_000)

test("a kind that waits for the kit does not pass it yet, else it leaves the list", async () => {
  for (const kind of elsewhere.filter((one) => one.kind in PENDING))
    expect(
      await conformance({ kind, ...GIVEN[kind.kind] }),
      `${kind.kind} passes the kit: take it off PENDING`
    ).not.toEqual([])
})
