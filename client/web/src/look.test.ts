/**
 * Banda UI's check (ADR 0113, decision 9; the guidelines' §5, `design.4`
 * and `design.9` to `design.13`): whatever the Window and the Panes draw
 * takes its colour, corner, type size, shadow, layer and lengths from
 * Banda UI, the theme's tokens and the names `@banda/ui` makes on them.
 *
 * `look` (`@banda/ui/testing/look`) finds each case in the files that
 * draw, the same the architecture test reads (`drawingFiles`). What is off
 * the vocabulary today is listed below, in groups, each with its rule and
 * its reason: why it stays, or the step of ADR 0113 that moves it. Two
 * tests hold the list: nothing more is off the vocabulary than it holds,
 * and a case that came onto the vocabulary leaves it. So the list only
 * falls (`borders.10`). A refusal says what to write instead; a case that
 * must stay is a line here, with its reason, in review.
 */
import { readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { BANDA, TOKENS, type Token } from "@banda/contract/look"
import { beyond, drawingFiles } from "@banda/ui/testing/architecture"
import {
  kitSheets,
  look,
  makesNames,
  refusal,
  type Rule,
} from "@banda/ui/testing/look"
import { expect, test } from "vitest"

const root = join(import.meta.dirname, "../../..")

/** Cases that are off the vocabulary today, of one rule, for one
 * reason. */
interface Listed {
  rule: Rule
  /** Why they stay, or the step that moves them (ADR 0113, "Steps"). */
  why: string
  /** Each case as `file: what`, once for each place. */
  cases: string[]
}

const LISTED: Listed[] = [
  // Colours (design.4, decision 6).
  {
    rule: "design.4",
    why: "Stays: masks and probes, where black and white say what shows or read a colour back, not a colour seen: the Mark's mask, a Project's sign's cut, the fades' masks, two canvas probes.",
    cases: [
      "apps/terminal/pane/src/theme.ts: #000",
      "client/ui/src/components/banda-mark.tsx: #000",
      "client/ui/src/components/banda-mark.tsx: #000",
      "client/ui/src/components/banda-mark.tsx: #000",
      "client/ui/src/components/banda-mark.tsx: #000",
      "client/ui/src/components/banda-mark.tsx: #000",
      "client/ui/src/components/banda-mark.tsx: #fff",
      "client/ui/src/components/banda-mark.tsx: #fff",
      "client/ui/src/components/banda-mark.tsx: #fff",
      "client/ui/src/components/banda-mark.tsx: #fff",
      "client/ui/src/components/project-sign.tsx: #000",
      "client/ui/src/lib/diagram-look.ts: #000",
      "client/ui/src/styles/globals.css: #000",
      "client/ui/src/styles/globals.css: #000",
      "client/ui/src/styles/globals.css: #000",
    ],
  },
  {
    rule: "design.4",
    why: "Stays: the kit's masks and fades, as the Window's: black says what shows.",
    cases: [
      "docs/design/kit/kit.css: #000",
      "docs/design/kit/kit.css: #000",
      "docs/design/kit/kit.css: #000",
      "docs/design/kit/kit.css: #000",
      "docs/design/kit/kit.css: #000",
      "docs/design/kit/kit.css: #000",
      "docs/design/kit/kit.css: #000",
      "docs/design/kit/kit.css: #000",
      "docs/design/kit/kit.css: #000",
      "docs/design/kit/kit.css: #000",
      "docs/design/kit/sub.css: #000",
      "docs/design/kit/sub.css: #000",
      "docs/design/kit/sub.css: #000",
      "docs/design/kit/sub.css: #000",
      "docs/design/kit/sub.css: #000",
      "docs/design/kit/sub.css: #000",
      "docs/design/kit/sub.css: #000",
      "docs/design/kit/sub.css: #000",
      "docs/design/kit/sub.css: #000",
      "docs/design/kit/sub.css: #000",
      "docs/design/kit/sub.css: #000",
      "docs/design/kit/sub.css: #000",
    ],
  },
  {
    rule: "design.4",
    why: "Stays: Recharts' own default strokes, matched to restyle them.",
    cases: [
      "client/ui/src/components/chart.tsx: #ccc",
      "client/ui/src/components/chart.tsx: #ccc",
      "client/ui/src/components/chart.tsx: #ccc",
      "client/ui/src/components/chart.tsx: #fff",
      "client/ui/src/components/chart.tsx: #fff",
    ],
  },
  {
    rule: "design.4",
    why: "Stays: the code highlighter's palette, copied for Files' JSON tree, until code's colours follow the theme (ADR 0113, not decided).",
    cases: [
      "client/ui/src/components/code-look.ts: #199f43",
      "client/ui/src/components/code-look.ts: #1ca1c7",
      "client/ui/src/components/code-look.ts: #5ecc71",
      "client/ui/src/components/code-look.ts: #68cdf2",
      "client/ui/src/components/code-look.ts: #d5512f",
      "client/ui/src/components/code-look.ts: #ff855e",
    ],
  },
  {
    rule: "design.4",
    why: "Stays: forced colours, where the system's own say what is checked, as no theme's colour reaches there: the sidebar's checked cards.",
    cases: [
      "client/ui/src/styles/globals.css: Highlight",
      "client/ui/src/styles/globals.css: HighlightText",
    ],
  },
  {
    rule: "design.4",
    why: "Stays: the Agent's pointer over a web page, outlined in white to read on any page.",
    cases: ["apps/browser/pane/src/BrowserPane.tsx: white"],
  },
  {
    rule: "design.4",
    why: "Step 4: `paper`, a document's own page, white in every theme: a notebook's, a page's, a PDF's.",
    cases: [
      "apps/files/pane/src/views/notebook.tsx: bg-white",
      "apps/files/pane/src/views/page.tsx: bg-white",
      "apps/files/pane/src/views/pdf.tsx: bg-white",
      "apps/files/pane/src/views/pdf.tsx: bg-white",
    ],
  },
  {
    rule: "design.4",
    why: "Step 4: `scrim`, black that dims: under a dialog, the Drawer, the Overview's lifted tile, a tile out of focus, a web page's veil, behind a video.",
    cases: [
      "apps/browser/pane/src/pages.ts: black",
      "apps/files/pane/src/views/media.tsx: bg-black",
      "client/ui/src/components/dialog.tsx: bg-black/10",
      "client/web/src/tiling/Overview.tsx: bg-black/50",
      "client/web/src/tiling/PaneFrame.tsx: bg-black",
      "client/web/src/window/Drawer.tsx: bg-black/10",
    ],
  },
  {
    rule: "design.4",
    why: "Step 4: the glass's light edge on a Group's plate, a glass token (ADR 0036).",
    cases: [
      "client/ui/src/styles/globals.css: rgb(255 255 255 / 0.03)",
      "client/ui/src/styles/globals.css: rgb(255 255 255 / 0.07)",
    ],
  },
  {
    rule: "design.4",
    why: "Step 4: the notifications module's fallback copies of tokens, for a system notification drawn before the look comes.",
    cases: [
      "platform/notifications/pane/src/system.ts: #16a34a",
      "platform/notifications/pane/src/system.ts: #1a1a1a",
      "platform/notifications/pane/src/system.ts: #71717a",
      "platform/notifications/pane/src/system.ts: #e7000b",
      "platform/notifications/pane/src/system.ts: #f5c542",
      "platform/notifications/pane/src/system.ts: #ff5a1f",
    ],
  },
  {
    rule: "design.4",
    why: "Step 4, drift onto tokens: white on three counts, the kit's too, which the count's own foreground has; hover fills of black and white, which the text thinned has.",
    cases: [
      "docs/design/kit/kit.css: #fff",
      "apps/browser/pane/src/Extensions.tsx: text-white",
      "apps/git/pane/src/GitButton.tsx: bg-black/[3.5%]",
      "apps/git/pane/src/GitButton.tsx: bg-white/8",
      "client/ui/src/components/thread-details.tsx: bg-black/[3.5%]",
      "client/ui/src/components/thread-details.tsx: bg-white/8",
      "client/web/src/bar/Bar.tsx: text-white",
    ],
  },
  {
    rule: "design.4",
    why: "Step 4, drift onto tokens: a PDF's find highlights and its text layer's selection and caret in the system's colours, a notebook's stderr in amber, the terminal renderer's default selection, which the `selection` and state tokens have.",
    cases: [
      "apps/files/pane/src/views/notebook.tsx: bg-amber-500/10",
      "apps/files/pane/src/views/pdf.css: AccentColor",
      "apps/files/pane/src/views/pdf.css: CanvasText",
      "apps/files/pane/src/views/pdf.css: rgb(249 115 22 / 0.6)",
      "apps/files/pane/src/views/pdf.css: rgb(250 204 21 / 0.4)",
      "client/ghostty/src/t3/renderer.ts: rgba(72, 122, 191, 0.35)",
    ],
  },

  // Corners (design.9, ADR 0080 decision 6): as the corner check listed
  // them, all stay.
  {
    rule: "design.9",
    why: "Stays: a Project's sign is an icon, its corner a share of its size, in the Window and the kit.",
    cases: [
      "client/ui/src/components/project-sign.tsx: borderRadius",
      "docs/design/kit/kit.css: border-radius: 4px",
      "docs/design/kit/kit.css: border-radius: 4px",
    ],
  },
  {
    rule: "design.9",
    why: "Stays: a Group's plate is its tiles' corner and its pad (ADR 0065, decision 6), in the Window and the kit.",
    cases: [
      "docs/design/kit/kit.css: border-radius: calc(var(--tile-radius) + var(--gap) / 2)",
      "client/ui/src/styles/globals.css: border-end-end-radius: var(--group-radius)",
      "client/ui/src/styles/globals.css: border-end-start-radius: var(--group-radius)",
      "client/ui/src/styles/globals.css: border-start-end-radius: var(--group-radius)",
      "client/ui/src/styles/globals.css: border-start-start-radius: var(--group-radius)",
    ],
  },
  {
    rule: "design.9",
    why: "Stays: the kit's stop button, a square drawn in CSS: an icon, as lucide's are.",
    cases: ["docs/design/kit/kit.css: border-radius: 2.5px"],
  },
  {
    rule: "design.9",
    why: "Stays: the Overview draws the levels at its scale.",
    cases: [
      "client/web/src/tiling/Overview.tsx: borderRadius",
      "client/web/src/tiling/Overview.tsx: borderRadius",
      "client/web/src/tiling/Overview.tsx: rounded-(--overview-plate)",
      "client/web/src/tiling/Overview.tsx: rounded-(--overview-radius)",
    ],
  },

  // Type (design.10, decision 3): step 2 moved every case onto the scale,
  // with Roma's answers to Q1, Q2 and Q3.
  {
    rule: "design.10",
    why: "Stays: the font view's specimen shows a font at sizes of its own.",
    cases: [
      "apps/files/pane/src/views/font.tsx: text-[1.5rem]",
      "apps/files/pane/src/views/font.tsx: text-[1.5rem]",
      "apps/files/pane/src/views/font.tsx: text-[2.25rem]",
    ],
  },

  // Shadows (design.11, decision 4): all move in step 3.
  {
    rule: "design.11",
    why: "Step 3: the Top layer's components become `float`: menus, a hover card, a popover, a select, the suggestions, a chart's tooltip, the browser's titles.",
    cases: [
      "apps/browser/pane/src/BrowserPane.tsx: shadow-lg",
      "client/ui/src/components/chart.tsx: shadow-xl",
      "client/ui/src/components/context-menu.tsx: shadow-md",
      "client/ui/src/components/dropdown-menu.tsx: shadow-lg",
      "client/ui/src/components/dropdown-menu.tsx: shadow-md",
      "client/ui/src/components/hover-card.tsx: shadow-md",
      "client/ui/src/components/popover.tsx: shadow-md",
      "client/ui/src/components/select.tsx: shadow-md",
      "client/ui/src/components/suggestions.tsx: shadow-md",
    ],
  },
  {
    rule: "design.11",
    why: "Step 3: what floats in a Pane or the Window becomes `float`: Find, a quote's button, the zoom badge and bars, a diff's hunk actions, a menu, a dialog, a tooltip, the Thread's details.",
    cases: [
      "apps/agents/pane/src/settings/ThreadSettings.tsx: shadow-md",
      "apps/agents/pane/src/thread/Details.tsx: shadow-sm",
      "apps/agents/pane/src/thread/Find.tsx: shadow-md",
      "apps/agents/pane/src/thread/Quote.tsx: shadow-md",
      "apps/agents/pane/src/thread/Transcript.tsx: shadow-md",
      "apps/agents/pane/src/visual/Visual.tsx: shadow-sm",
      "apps/browser/pane/src/BrowserPane.tsx: shadow-lg",
      "apps/browser/pane/src/PageDialog.tsx: shadow-xl",
      "apps/files/pane/src/PathBar.tsx: shadow-md",
      "apps/files/pane/src/views/code.tsx: shadow-sm",
      "apps/files/pane/src/views/hex.tsx: shadow-md",
      "apps/files/pane/src/views/pdf.tsx: shadow-md",
      "apps/files/pane/src/views/zoom-bar.tsx: shadow-sm",
      "apps/terminal/pane/src/TerminalPane.tsx: shadow-md",
      "client/ui/src/components/code-diff.tsx: shadow-md",
      "client/ui/src/components/zoom-badge.tsx: shadow-sm",
      "client/web/src/safe/Broke.tsx: shadow-lg",
      "client/web/src/sidebar/Edge.tsx: shadow-md",
    ],
  },
  {
    rule: "design.11",
    why: "Step 3: what the Person carries becomes `lift`: a Pane being moved, a widget dragged on the Bar, a workspace lifted in the Overview, a Peek.",
    cases: [
      "client/web/src/bar/Bar.tsx: shadow-lg",
      "client/web/src/tiling/Overview.tsx: shadow-[0_12px_28px_rgb(0_0_0/0.4)]",
      "client/web/src/tiling/useMoving.ts: shadow-md",
      "client/web/src/window/Peek.tsx: shadow-[0_30px_80px_-12px_rgb(0_0_0/0.45)]",
    ],
  },
  {
    rule: "design.11",
    why: "Step 3: what does not float loses its shadow, or floats: a picked segment, the sidebar's view menu's, the Projects list's pick, the Overview's labels on its tiles, a thumbnail's button, a Group's handle, a machine's pill, a switch's and a slider's thumb.",
    cases: [
      "client/ui/src/components/level-slider.tsx: shadow-[0_0_0_0.5px_rgb(0_0_0/0.14),0_1px_2px_rgb(0_0_0/0.22),0_2px_6px_rgb(0_0_0/0.12)]",
      "client/ui/src/components/level-slider.tsx: shadow-[0_0_0_0.5px_rgb(0_0_0/0.14),0_1px_3px_rgb(0_0_0/0.28),0_3px_10px_rgb(0_0_0/0.16)]",
      "client/ui/src/components/switch.tsx: shadow",
      "client/ui/src/components/thumbnail.tsx: shadow-sm",
      "client/web/src/settings/SignField.tsx: shadow-xs",
      "client/web/src/sidebar/ProjectsList.tsx: shadow-xs",
      "client/web/src/sidebar/ViewMenu.tsx: shadow-xs",
      "client/web/src/tiling/Overview.tsx: shadow-sm",
      "client/web/src/tiling/Overview.tsx: shadow-sm",
      "client/web/src/tiling/Strip.tsx: shadow-sm",
      "client/web/src/window/named.tsx: shadow-sm",
    ],
  },
  {
    rule: "design.11",
    why: "Step 3 decides: shadows of their own, the browser's inset glow while an Agent drives it, the Agent's pointer's shadow, a PDF page's lift off its ground.",
    cases: [
      "apps/browser/pane/src/BrowserPane.tsx: drop-shadow-[0_1px_2px_rgb(0_0_0_/_0.3)]",
      "apps/browser/pane/src/BrowserPane.tsx: shadow-[inset_0_0_30px_color-mix(in_srgb,var(--primary)_40%,transparent)]",
      "apps/files/pane/src/views/pdf.tsx: shadow-[0_4px_18px_rgb(0_0_0/0.18)]",
    ],
  },

  {
    rule: "design.11",
    why: "Step 3: the kit's shadows, drawn by hand, go onto the elevations as the Window's do: the window over the desktop, a tile, the focused tile, the glass sidebar's panel, the light message box's haze, the Top layer, a floating tip.",
    cases: [
      "docs/design/kit/kit.css: box-shadow: 0 0 0 1px var(--window-line), inset 0 1px 0 var(--window-highlight), 0 30px 70px -20px rgb(0 0 0 / 0.55), 0 10px 24px -12px rgb(0 0 0 / 0.3)",
      "docs/design/kit/kit.css: box-shadow: inset 0 0 0 1px var(--border), var(--tile-shadow)",
      "docs/design/kit/kit.css: box-shadow: inset 0 0 0 1px var(--focus), var(--focus-shadow), var(--tile-shadow)",
      "docs/design/kit/kit.css: box-shadow: inset 0 0 0 1px var(--border), var(--panel-shadow)",
      "docs/design/kit/kit.css: box-shadow: 0 0 0 1px rgb(0 0 0 / 0.04), 0 2px 8px rgb(0 0 0 / 0.04), 0 4px 40px 8px rgb(0 0 0 / 0.024)",
      "docs/design/kit/kit.css: box-shadow: 0 0 0 1px color-mix(in oklab, var(--foreground) 12%, transparent), 0 16px 40px -12px rgb(0 0 0 / 0.35), 0 2px 8px rgb(0 0 0 / 0.08)",
      "docs/design/kit/kit.css: box-shadow: 0 0 0 1px var(--border), 0 12px 32px -12px rgb(0 0 0 / 0.4)",
      "docs/design/kit/sub.css: box-shadow: 0 0 0 1px rgb(0 0 0 / 0.04), 0 2px 8px rgb(0 0 0 / 0.04), 0 4px 40px 8px rgb(0 0 0 / 0.024)",
      "docs/design/kit/sub.css: box-shadow: 0 6px 16px -6px rgb(0 0 0 / 0.4)",
    ],
  },

  // Layers (design.12, decision 5): all move in step 5, with ADR 0110
  // step 3.
  {
    rule: "design.12",
    why: "Step 5: the Top layer's 50, shadcn's menus, dialogs and popovers and the browser's titles, becomes `z-top`; a carried Pane's, `z-carried`.",
    cases: [
      "apps/browser/pane/src/BrowserPane.tsx: z-50",
      "client/ui/src/components/context-menu.tsx: z-50",
      "client/ui/src/components/context-menu.tsx: z-50",
      "client/ui/src/components/dialog.tsx: z-50",
      "client/ui/src/components/dialog.tsx: z-50",
      "client/ui/src/components/dropdown-menu.tsx: z-50",
      "client/ui/src/components/dropdown-menu.tsx: z-50",
      "client/ui/src/components/hover-card.tsx: z-50",
      "client/ui/src/components/hover-card.tsx: z-50",
      "client/ui/src/components/popover.tsx: z-50",
      "client/ui/src/components/popover.tsx: z-50",
      "client/ui/src/components/select.tsx: z-50",
      "client/ui/src/components/select.tsx: z-50",
      "client/ui/src/components/suggestions.tsx: z-50",
      "client/web/src/tiling/useMoving.ts: z-50",
      "client/web/src/tiling/useMoving.ts: z-50",
    ],
  },
  {
    rule: "design.12",
    why: "Step 5: the Window's areas take their layer's name: the sidebar and its edge, the Drawer and sheets, a Peek, a carried Pane's place.",
    cases: [
      "client/web/src/sidebar/Edge.tsx: z-30",
      "client/web/src/sidebar/Sidebar.tsx: z-20",
      "client/web/src/tiling/PaneMenu.tsx: z-40",
      "client/web/src/window/Drawer.tsx: z-30",
      "client/web/src/window/Peek.tsx: z-20",
      "client/web/src/window/Sheet.tsx: z-30",
    ],
  },
  {
    rule: "design.12",
    why: "Step 5: inside a Pane or a component, `z-raised` above its siblings or `z-float` for its floating bar and sticky head, once each Tile isolates its stacking.",
    cases: [
      "apps/agents/pane/src/entries/parts/Messages.tsx: z-10",
      "apps/agents/pane/src/thread/Details.tsx: z-10",
      "apps/agents/pane/src/thread/Find.tsx: z-10",
      "apps/agents/pane/src/thread/Minimap.tsx: z-10",
      "apps/agents/pane/src/thread/Quote.tsx: z-20",
      "apps/browser/pane/src/PageDialog.tsx: z-10",
      "apps/files/pane/src/PathBar.tsx: z-20",
      "apps/files/pane/src/views/hex.tsx: z-20",
      "apps/files/pane/src/views/pdf.css: z-index: 1",
      "apps/files/pane/src/views/pdf.tsx: z-10",
      "apps/terminal/pane/src/TerminalPane.tsx: z-10",
      "client/ghostty/src/t3/surface.ts: z-1",
      "client/ui/src/components/bubble.tsx: z-10",
      "client/ui/src/components/code-diff.tsx: z-index: 4",
      "client/ui/src/components/resizable.tsx: z-10",
      "client/ui/src/components/select.tsx: z-10",
      "client/ui/src/components/select.tsx: z-10",
      "client/ui/src/components/virtual-list.tsx: z-10",
      "client/ui/src/components/zoom-badge.tsx: z-10",
      "client/ui/src/styles/globals.css: z-index: 1",
      "client/web/src/bar/Bar.tsx: z-10",
      "client/web/src/sidebar/CardView.tsx: -z-10",
      "client/web/src/sidebar/GroupHeader.tsx: -z-10",
      "client/web/src/tiling/Overview.tsx: z-1",
      "client/web/src/tiling/Overview.tsx: z-1",
      "client/web/src/tiling/Overview.tsx: z-1",
      "client/web/src/tiling/Overview.tsx: z-10",
      "client/web/src/tiling/PaneFrame.tsx: z-10",
      "client/web/src/tiling/PaneFrame.tsx: z-10",
      "client/web/src/tiling/PaneFrame.tsx: z-10",
      "client/web/src/tiling/Strip.tsx: z-10",
      "client/web/src/tiling/Workspaces.tsx: z-1",
      "client/web/src/tiling/Workspaces.tsx: z-2",
      'client/web/src/tiling/layout.ts: zIndex: "1"',
    ],
  },

  {
    rule: "design.12",
    why: "Step 5: the kit's two layers take their names as the Window's do: the blurred wallpaper under the glass, the floating tip over all.",
    cases: [
      "docs/design/kit/kit.css: z-index: -2",
      "docs/design/kit/sub.css: z-index: 1000",
    ],
  },

  // Lengths (design.13, decision 7): all move in step 5.
  {
    rule: "design.13",
    why: "Step 5: the Usage Pane's, the limits' widget's and the spend card's lengths go onto Tailwind's steps.",
    cases: [
      "platform/harnesses/pane/src/LimitsWidget.tsx: -top-[3px]",
      "platform/harnesses/pane/src/LimitsWidget.tsx: h-[3px]",
      "platform/harnesses/pane/src/LimitsWidget.tsx: size-[5px]",
      "platform/harnesses/pane/src/LimitsWidget.tsx: w-[22px]",
      "platform/harnesses/pane/src/Spend.tsx: gap-x-[22px]",
      "platform/harnesses/pane/src/Spend.tsx: mt-[18px]",
      "platform/harnesses/pane/src/Spend.tsx: mt-[22px]",
      "platform/harnesses/pane/src/Spend.tsx: mt-[22px]",
      "platform/harnesses/pane/src/Spend.tsx: pb-[5px]",
      "platform/harnesses/pane/src/Spend.tsx: pb-[5px]",
      "platform/harnesses/pane/src/UsagePane.tsx: -top-[3px]",
      "platform/harnesses/pane/src/UsagePane.tsx: gap-[22px]",
      "platform/harnesses/pane/src/UsagePane.tsx: gap-[7px]",
      "platform/harnesses/pane/src/UsagePane.tsx: h-[11px]",
      "platform/harnesses/pane/src/UsagePane.tsx: h-[5px]",
      "platform/harnesses/pane/src/UsagePane.tsx: mb-[18px]",
      "platform/harnesses/pane/src/UsagePane.tsx: py-[18px]",
    ],
  },
  {
    rule: "design.13",
    why: "Step 5: lengths off the grid elsewhere go onto Tailwind's steps: the Agent's pointer in the browser, an input group's addons, a trace's icon, a limit's line, a widget's nudge, a Thread setting's padding.",
    cases: [
      "apps/agents/pane/src/lines/limit.tsx: w-[1.5px]",
      "apps/agents/pane/src/settings/ThreadSettings.tsx: px-[7px]",
      "apps/browser/pane/src/BrowserPane.tsx: -ml-[3px]",
      "apps/browser/pane/src/BrowserPane.tsx: -mt-[3px]",
      "apps/browser/pane/src/BrowserPane.tsx: size-[18px]",
      "client/ui/src/components/input-group.tsx: ml-[-0.15rem]",
      "client/ui/src/components/input-group.tsx: ml-[-0.3rem]",
      "client/ui/src/components/input-group.tsx: mr-[-0.15rem]",
      "client/ui/src/components/input-group.tsx: mr-[-0.3rem]",
      "client/ui/src/components/trace.tsx: size-[0.9375rem]",
      "client/web/src/tiling/widgets.tsx: left-[0.0625rem]",
    ],
  },
]

/** Each case found, as `rule file: what`, with its refusal: in the files
 * that draw, and in the kit's stylesheets, which draw the mocks. */
const pairs = [...drawingFiles(root), ...kitSheets()].flatMap((file) => {
  const at = relative(root, file)
  return look(readFileSync(file, "utf8"), { names: makesNames(file) }).map(
    (each) =>
      [`${each.rule} ${at}: ${each.what}`, `${at}: ${refusal(each)}`] as const
  )
})
const found = new Map<string, string>(pairs)
const keys = pairs.map(([key]) => key)
const listed = LISTED.flatMap(({ rule, cases }) =>
  cases.map((each) => `${rule} ${each}`)
)

test("nothing draws off Banda UI beyond the list (ADR 0113)", () => {
  expect(beyond(keys, listed).map((key) => found.get(key))).toEqual([])
})

test("a case that came onto Banda UI leaves the list", () => {
  expect(beyond(listed, keys)).toEqual([])
})

test("each group of the list says why, and holds a case", () => {
  for (const { why, cases } of LISTED) {
    expect(why).toMatch(/^(?:Stays|Step [1-5])/)
    expect(cases.length).toBeGreaterThan(0)
  }
})

/** The custom properties the kit defines in its rules of `selector`, by
 * their names without `--`. */
function kitDefines(selector: string): Map<string, string> {
  const sheet = readFileSync(join(root, "docs/design/kit/kit.css"), "utf8")
  const rules = [
    ...sheet.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g),
  ].filter(([, head]) => head.trim() === selector)
  expect(rules.length, selector).toBeGreaterThan(0)
  return new Map(
    rules.flatMap(([, , body]) =>
      [...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(
        ([, name, value]) => [name, value.trim()] as const
      )
    )
  )
}

/** Where the kit draws otherwise on purpose: the design reference's
 * "Where the kit and the code differ". */
const KIT_DIFFERS: Partial<Record<Token, string>> = {
  "tile-opacity":
    "a tile over glass: 95% in the kit, solid in the window (ADR 0075, decision 3)",
}

test("the kit's tokens are the theme's: its colours, its type scale and its corners", () => {
  const schemes = {
    dark: kitDefines(':root,\n[data-theme="dark"]'),
    light: kitDefines('[data-theme="light"]'),
  }
  // Type, shape and glass are the same in both schemes.
  const both = kitDefines(":root")
  const own = (name: string): name is Token =>
    name in TOKENS && !(name in KIT_DIFFERS)
  const off = (["dark", "light"] as const).flatMap((mode) =>
    [...schemes[mode], ...both].flatMap(([name, value]) =>
      own(name) && value !== BANDA[mode][name]
        ? [
            `${mode} ${name}: the kit's ${value}, the theme's ${BANDA[mode][name]}`,
          ]
        : []
    )
  )
  expect(off).toEqual([])
  // The kit names every level, so a mock draws each as the window does.
  const levels = Object.entries(TOKENS)
    .filter(
      ([, { kind, group }]) =>
        kind === "length" && (group === "radius" || group === "font")
    )
    .map(([name]) => name)
  expect(levels.filter((name) => !both.has(name))).toEqual([])
})
