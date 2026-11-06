/**
 * What every view of code on `@pierre/diffs` shares, the Diff's and a
 * file's: one pool of highlighting workers for the window, the themes,
 * and the colours on Banda's tokens, as T3 Code mixes them.
 */

export const THEMES = { dark: "pierre-dark", light: "pierre-light" } as const

/** One pool of highlighting workers for every view in the window. */
export const POOL = {
  workerFactory: () =>
    new Worker(new URL("./diffs-worker.ts", import.meta.url), {
      type: "module",
    }),
  poolSize: Math.max(
    2,
    Math.min(6, Math.floor((navigator.hardwareConcurrency || 4) / 2))
  ),
  totalASTLRUCacheSize: 240,
}

export const HIGHLIGHTER = { theme: THEMES, tokenizeMaxLineLength: 1_000 }

/** The surface is the tile, the text Banda's, the fonts Banda's; rows mix
 * `added` and `removed` into the tile, stronger in dark. */
export const BASE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --code: var(--background);
  --ink: var(--foreground);
  --diffs-header-font-family: var(--font-sans) !important;
  --diffs-font-family: var(--font-mono) !important;
  --diffs-bg: var(--code) !important;
  --diffs-light-bg: var(--code) !important;
  --diffs-dark-bg: var(--code) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;
  --diffs-bg-context-override: color-mix(in srgb, var(--code) 97%, var(--ink));
  --diffs-bg-hover-override: color-mix(in srgb, var(--code) 94%, var(--ink));
  --diffs-bg-separator-override: color-mix(in srgb, var(--code) 95%, var(--ink));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--code) 90%, var(--ink));
  --diffs-bg-addition-override: color-mix(in srgb, var(--code) var(--diff-row), var(--added));
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--code) var(--diff-number), var(--added));
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--code) 85%, var(--added));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--code) 80%, var(--added));
  --diffs-bg-deletion-override: color-mix(in srgb, var(--code) var(--diff-row), var(--removed));
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--code) var(--diff-number), var(--removed));
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--code) 85%, var(--removed));
  --diffs-bg-deletion-emphasis-override: color-mix(in srgb, var(--code) 80%, var(--removed));
  background-color: var(--diffs-bg) !important;
  color: var(--ink) !important;
}

[data-diff], [data-file] { transition: opacity 200ms ease-out; }
@starting-style { [data-diff], [data-file] { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { [data-diff], [data-file] { transition: none; } }
`

/** The class of the element that holds a view: the strength of its rows'
 * colours, and its own scroll, as it reads its scroll to draw only the
 * rows in sight and sets no overflow of its own. */
export const VIEW_CLASS =
  "[--diff-number:35%] [--diff-row:50%] dark:[--diff-number:60%] dark:[--diff-row:70%] overflow-auto outline-none"
