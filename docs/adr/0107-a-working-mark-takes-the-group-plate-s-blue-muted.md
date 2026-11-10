---
status: accepted
date: 2026-11-10
---

# A working Mark takes the Group plate's blue, muted

_It amends ADR 0099 (decision 10: the colour of a working Mark) and says
what ADR 0098's grey Working shelf (decision 3) leaves to the Mark._

Roma, on 2026-11-10 (translated), over the sidebar's review page: "what if
the working Agent were blue like the plate? Then there is one visual
style." Of three mocks (grey as it is, the plate's blue in full, and the
plate's blue muted), Roma took the muted one.

One state had two colours: a Group at work is blue on its plate (ADR
0065), and its Thread's Mark was grey. ADR 0099 asked that working "does
not make noise", so the blue is muted to about the grey's weight.

## Decision

1. **A working Mark is `--working`, muted**: 60% on a dark theme, 80% on a
   light one. `--working` is the token the Group's plate uses.
2. **Only the Mark.** A working row's title and time stay as they were.
   No blue rows, fills, borders or progress bars.
3. **All of the Mark.** Its satellites take its colour, as they already
   took its grey; a failed sub-agent's stays red (ADR 0103, decision 13).
   The bar's logo, at work, has its hat in the same blue. The bar's counts
   stay grey.
4. **`--working` means an Agent at work, and nothing else.** It is not the
   accent and does not follow it: the accent stays focus, selection and
   links, and is never a state (ADR 0075, decision 4).

## Why muted

Contrast with the sidebar's glass, for a mark of 16 px:

| | dark glass | light glass |
|---|---|---|
| grey, as it was | 2.46 | 2.43 |
| `--working` in full | 4.95 | 3.2 |
| `--working` muted | 2.77 (60%) | 2.48 (80%) |

In full it is twice the grey on dark glass, and a Working tab becomes a
wall of blue beside the calls' colours. The light theme needs the higher
share, since 60% there comes out paler than the grey (1.94).

## Consequences

- In the window this is the two values of `--mark-working` in
  `client/ui/src/styles/globals.css`. The Mark's shapes and motion do not
  change.
- [`docs/design/README.md`](../design/README.md) and its kit follow, so
  mocks draw it the same way.
