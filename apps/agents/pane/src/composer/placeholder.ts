/**
 * What the empty composer says (ADR 0058, decision 8). While a turn runs
 * that a message can go into, it is the way to steer the Thread; Enter
 * and the button still steer or queue as the Person chose (ADR 0010,
 * decision 7). Else it says whom the message goes to and what it can
 * name, and on another machine's Thread, which machine (ADR 0095,
 * decision 7). A Question or a plan that waits says its own, before this.
 */
export function placeholder(
  name: string,
  steering: boolean,
  skills: boolean,
  machine?: string
): string {
  if (steering) return "Steer this thread…"
  const to = machine === undefined ? name : `${name} on ${machine}`
  return `Write to ${to}. @ files, / commands${skills ? ", $ skills" : ""}`
}
