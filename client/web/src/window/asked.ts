/**
 * What is asked of the Window from outside it: an action to run, by its
 * id, as its key does (ADR 0127, decision 2), and what a Pane in a window
 * of its own asks (ADR 0025, decision 9). The device hands both on, and
 * the Window does them as for its own.
 *
 * An action comes from the engine, for `banda act` and an Agent's `act`
 * tool, or from the device itself, as its menu bar. The engine has
 * checked its id, its args and who asks; here it runs where the Person
 * is now, and the Window answers: it ran, or why not.
 */
import type { ActAsk } from "@banda/core"
import { actInScope, scopesOf } from "@banda/ui/hooks/use-scope"
import { useEffect } from "react"
import { device } from "../boot"
import type { Frame } from "../tiling/PaneFrame"
import { ACTIONS, runAction, type Shell } from "./actions"

/**
 * Runs the action asked, with Here as it is now; why it did not run, if
 * it did not:
 *
 * - the Window has no such action, as one of a newer Banda's;
 * - it is a scope's (ADR 0071, decision 1), and the focus is not in that
 *   scope: it runs for the Pane in focus, when that Pane is of the scope;
 * - it did not run there, as the router says ("Not on arc yet: …"), or as
 *   the scope left it.
 */
export async function act(
  shell: Shell,
  { action: id, args }: Pick<ActAsk, "action" | "args">
): Promise<string | undefined> {
  const action = ACTIONS.find((one) => one.id === id)
  if (!action) return `Banda's window has no action ${id}.`
  const { scope } = action
  if (scope === undefined) {
    const went = await runAction(shell, action, args)
    return went.runs ? undefined : went.said
  }
  if (!scopesOf(document.activeElement).includes(scope))
    return `${id} runs in the scope "${scope}", and the focus is not there now.`
  return actInScope(scope, id, args)
    ? undefined
    : `${id} did nothing where the focus is now.`
}

/** Does what the device hands on while the Window shows: the actions
 * asked from outside it, each answered, and what a Pane in its own window
 * asks, opened by `open` or run. */
export function useAsked(shell: Shell, open: Frame["open"]): void {
  useEffect(
    () =>
      device.act.asked((asked) => {
        void act(shell, asked)
          // An action that broke says so, as any other that did not run.
          .catch((error: unknown) => String(error))
          .then((refused) =>
            device.act.answer({
              id: asked.id,
              ...(refused !== undefined && { refused }),
            })
          )
      }),
    [shell]
  )
  useEffect(
    () =>
      device.popped.asked((asked) => {
        if ("open" in asked) {
          const { project, pane, from, place } = asked.open
          open(project, pane, from, place)
        } else if ("run" in asked) {
          shell.run(asked.run.action, asked.run.args)
        }
      }),
    [open, shell]
  )
}
