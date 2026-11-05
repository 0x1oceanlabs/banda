/**
 * The branch picker's rules, as T3 Code's (`BranchToolbar.logic.ts`):
 * which branches it lists, what a search finds, and the name Create
 * branch makes of the words. Pure, so plain tests cover them.
 */
import type { Ref } from "@banda/contract/git"

/** The most a made name is long, as the engine's (`BRANCH`). */
const LONGEST = 64

/** The name Create branch makes of `words`, as the engine names a
 * branch (`slug`, without its `feature/`): lower case, letters, digits,
 * `/`, `_` and `-` only, each other character a `-`, no `-` nor `/` twice
 * or at an end, at most 64 long. Empty when none is left.
 * `branch-names.json` holds both to it. */
export function branchName(words: string): string {
  const name = words
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[/-]+|[/-]+$/g, "")
  return name.slice(0, LONGEST).replace(/[/-]+$/, "")
}

/** What a Thread's Agent reads of a switch from its card to `ref`: a
 * remote's is checked out through a branch here that follows it. */
export function switchedOf(ref: Ref): string {
  return ref.remote
    ? `Switched to the branch ${shortOf(ref)}, which follows ${ref.name}; the changes went along.`
    : `Switched to the branch ${ref.name}; the changes went along.`
}

/** What a Thread's Agent reads of a branch `name` made from its card. */
export function madeOf(name: string): string {
  return `Made the branch ${name} and switched to it; the changes went along.`
}

/** A remote's branch as here's would be named: `origin/x` is `x`. */
export function shortOf(ref: Ref): string {
  return ref.remote ? ref.name.slice(ref.name.indexOf("/") + 1) : ref.name
}

/** The branches to list: a remote's left out when one here has its name,
 * as T3 Code's, so the default one is here's. */
export function listedOf(refs: readonly Ref[]): Ref[] {
  const here = new Set(refs.filter((ref) => !ref.remote).map(shortOf))
  return refs.filter((ref) => !ref.remote || !here.has(shortOf(ref)))
}

/** Whether `ref` is found by `words`, as typed or as the name they
 * make (`made`, their `branchName`). */
export function finds(ref: Ref, words: string, made: string): boolean {
  const name = ref.name.toLowerCase()
  return name.includes(words.toLowerCase()) || (!!made && name.includes(made))
}

/** Whether a branch, here or on a remote, has the name `made` or is in
 * its way, as the engine's `in_way`: `fix` is in the way of `fix/login`,
 * and that of it. */
export function taken(refs: readonly Ref[], made: string): boolean {
  const inside = (outer: string, inner: string) => inner.startsWith(`${outer}/`)
  return refs.some((ref) => {
    const name = shortOf(ref)
    return name === made || inside(name, made) || inside(made, name)
  })
}
