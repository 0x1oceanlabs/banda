/**
 * What the timeline does with each kind of entry (ADR 0091, decision 2):
 * thoughts and calls are work, which folds into one line (ADR 0058,
 * decision 4); a Visual stays out of a turn's fold, as it was shown to be
 * seen (ADR 0037), and so does a divider where the Thread moved (ADR
 * 0078). Pure, so the timeline and its tests read it; a kind
 * missing here does not compile.
 */
import type { Body } from "@banda/contract/agents"

type Rules = {
  /** It is work: it groups into the work line and folds with its turn. */
  work?: true
  /** It stays out of its turn's fold. */
  stays?: true
}

export const ENTRY_KINDS: Record<Body["kind"], Rules> = {
  message: {},
  thought: { work: true },
  tool: { work: true },
  plan: {},
  question: {},
  notice: {},
  moved: { stays: true },
  issue: {},
  visual: { stays: true },
}

export const isWorkKind = (kind: Body["kind"]): boolean =>
  ENTRY_KINDS[kind].work === true

export const staysKind = (kind: Body["kind"]): boolean =>
  ENTRY_KINDS[kind].stays === true
