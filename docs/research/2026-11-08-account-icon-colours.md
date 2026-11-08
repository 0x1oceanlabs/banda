# The account colours, when the mark is an icon in its colour

Evidence for ADR 0093: whether an account's icon, drawn in its colour with
no ground, keeps the accounts of one Harness apart, in the light theme and
the dark one.

- **Date:** 2026-11-08.
- **Sources:** ADR 0078's four colours (decision 10); the theme tokens in
  `client/ui/src/styles/globals.css` at `aaae02c1` (the sidebar `#fafafa`
  light, `#202024` dark); Claude's orange `#d97757` from
  `client/ui/src/components/harness-logo.tsx`; the script
  [`2026-11-08-account-icon-colours/colour.py`](2026-11-08-account-icon-colours/colour.py).
- **Method:** WCAG contrast of each colour on the sidebar, and CIEDE2000
  between every two colours one Harness offers, seen normally and through
  Machado 2009's deuteranopia, protanopia and tritanopia at severity 1.
  The bars are those ADR 0078 used: ΔE ≥ 8.9 for every pair, and 3:1 for
  a drawing on its background (WCAG 1.4.11).
- **Limits:** flat colours, not the strokes of a 16 px icon, where a thin
  line reads lighter than its colour. Only the sidebar's background; a
  popover's is close to it. The mockups are in Roma's
  `~/Banda/artifacts/agent-icons/` (`agent-icons-v1…v3.html`); nobody
  colour-blind looked at them.

## 1. What changes from ADR 0078

ADR 0078 checked four colours, and kept orange out for Claude's logo. With
the icon as the mark, the Harness's own colour is a fifth choice: Claude's
orange for Claude Code's accounts, the text colour for Codex's. So each
Harness offers five colours, and the orange now sits beside the four.

## 2. ADR 0078's colours with the own colours

| Theme | Harness | Lowest contrast | Closest pair, normal | deutan | protan | tritan |
|---|---|---|---|---|---|---|
| light | Claude Code | 2.99 (orange) | 21.0 | **5.1** (orange–green) | **8.7** (orange–green) | 18.5 |
| light | Codex | 3.01 (green) | 13.5 (own–graphite) | 13.5 | 13.4 | 13.3 |
| dark | Claude Code | 3.62 (rose) | 22.0 | **4.0** (orange–green) | 9.7 | 10.4 |
| dark | Codex | 3.62 (rose) | 12.9 (own–graphite) | 12.9 | 12.9 | 12.9 |

- Claude's orange and the green are one colour to a deuteranope: ΔE 5.1
  and 4.0. Their lightness is close and their hues fold together.
- In the light theme the orange (2.99) and the green (3.01) are at the 3:1
  line, too low for a thin icon.
- Codex's own colour, inverted with the theme, is far from the four in
  both: its closest is graphite, ΔE 12.9 and more.

## 3. What fixes it

A search over OKLCH for the green nearest ADR 0078's, keeping ΔE ≥ 10 from
every other colour of both Harnesses under all four kinds of sight and
contrast ≥ 3.4, found a green turned a little to teal. The light orange is
Claude's darker `#c96442`.

| | Light | Dark |
|---|---|---|
| green | `#189a69` (was `#17a750`) | `#15b77c` (was `#1eab53`) |
| Claude's orange | `#c96442` (was `#d97757`) | `#d97757` |

| Theme | Harness | Lowest contrast | Closest pair, normal | deutan | protan | tritan |
|---|---|---|---|---|---|---|
| light | Claude Code | 3.43 | 21.0 | 12.7 | 10.7 | 12.3 |
| light | Codex | 3.43 | 13.5 | 13.5 | 13.4 | 13.3 |
| dark | Claude Code | 3.62 | 22.0 | 10.1 | 11.6 | 10.4 |
| dark | Codex | 3.62 | 12.9 | 12.9 | 12.9 | 12.9 |

The closest pair anywhere goes from ΔE 4.0 to 10.1. A darker green (about
`#1b670c`) parts further from the orange in the light theme, but reads as
a different colour from the dark theme's; the teal keeps one green in both.

## 4. The icons

- Claude's spark and OpenAI's knot are the drawings
  `client/ui/src/components/harness-logo.tsx` has, from T3 Code (MIT).
- Codex's mark is LobeHub's (`lobehub/lobe-icons`,
  `src/Codex/components/Mono.tsx`, MIT): a filled shape with `>_` cut out.
  Omarchy's agents panel carries the same file.
- Claude Code's character is drawn from the block characters its CLI
  prints at start, `▐▛███▜▌ / ▝▜█████▛▘ / ▘▘ ▝▝`: 18 × 10 cells. It is
  wider than it is tall, so at 16 px high it needs about 21 px of width to
  weigh as much as the spark.
- Every mark is its owner's.
