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
import { beyond, drawingFiles } from "@banda/ui/testing/architecture"
import { look, makesNames, refusal, type Rule } from "@banda/ui/testing/look"
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
    why: "Step 4, drift onto tokens: white on two counts, which the count's own foreground has; hover fills of black and white, which the text thinned has.",
    cases: [
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
    why: "Stays: a Project's sign is an icon, its corner a share of its size.",
    cases: ["client/ui/src/components/project-sign.tsx: borderRadius"],
  },
  {
    rule: "design.9",
    why: "Stays: a Group's plate is its tiles' corner and its pad (ADR 0065, decision 6).",
    cases: [
      "client/ui/src/styles/globals.css: border-end-end-radius: var(--group-radius)",
      "client/ui/src/styles/globals.css: border-end-start-radius: var(--group-radius)",
      "client/ui/src/styles/globals.css: border-start-end-radius: var(--group-radius)",
      "client/ui/src/styles/globals.css: border-start-start-radius: var(--group-radius)",
    ],
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

  // Type (design.10, decision 3): all move in step 2, with Roma's
  // answers to Q1, Q2 and Q3.
  {
    rule: "design.10",
    why: "Step 2, Q1: sizes from 9 to 11.5 px go to `text-small` (a key, a tag, a count on an icon, a menu's label) or up to `text-meta` (captions, footers, notes).",
    cases: [
      "apps/agents/pane/src/asking/QuestionForm.tsx: text-[10.5px]",
      "apps/agents/pane/src/composer/CommentList.tsx: text-[11px]",
      "apps/agents/pane/src/entries/subagent.tsx: text-[11px]",
      "apps/agents/pane/src/settings/AccountCards.tsx: text-[10px]",
      "apps/browser/pane/src/BrowserPane.tsx: text-[10.5px]",
      "apps/browser/pane/src/Extensions.tsx: text-[9px]",
      "apps/browser/pane/src/Lend.tsx: text-[11px]",
      "apps/files/pane/src/Columns.tsx: text-[11px]",
      "apps/files/pane/src/Gallery.tsx: text-[10.5px]",
      "apps/files/pane/src/Info.tsx: text-[10.5px]",
      "apps/files/pane/src/PathBar.tsx: text-[10.5px]",
      "apps/files/pane/src/Rail.tsx: text-[10.5px]",
      "apps/files/pane/src/SearchView.tsx: text-[10.5px]",
      "apps/files/pane/src/SearchView.tsx: text-[10.5px]",
      "apps/files/pane/src/SearchView.tsx: text-[10px]",
      "apps/files/pane/src/SearchView.tsx: text-[11px]",
      "apps/files/pane/src/TrashList.tsx: text-[10.5px]",
      "apps/files/pane/src/TreePane.tsx: text-[10.5px]",
      "apps/files/pane/src/TreePane.tsx: text-[10.5px]",
      "apps/files/pane/src/TreePane.tsx: text-[11px]",
      "apps/files/pane/src/ViewParts.tsx: text-[10px]",
      "apps/files/pane/src/views/font.tsx: text-[0.625rem]",
      "apps/git/pane/src/BranchPicker.tsx: text-[10px]",
      "apps/git/pane/src/BranchPicker.tsx: text-[11px]",
      "apps/git/pane/src/GitButton.tsx: text-[11px]",
      "apps/git/pane/src/GitButton.tsx: text-[11px]",
      "client/ui/src/components/kbd.tsx: text-[11px]",
      "client/ui/src/components/line-comment.tsx: text-[10.5px]",
      "client/web/src/bar/Bar.tsx: text-[9px]",
      "client/web/src/bar/Update.tsx: text-[10.5px]",
      "client/web/src/bar/Update.tsx: text-[11.5px]",
      "client/web/src/bar/Update.tsx: text-[11px]",
      "client/web/src/bar/Update.tsx: text-[11px]",
      "client/web/src/bar/Update.tsx: text-[11px]",
      "client/web/src/bar/Update.tsx: text-[11px]",
      "client/web/src/settings/Mod.tsx: text-[11px]",
      "client/web/src/settings/ProblemsSettings.tsx: text-[11.5px]",
      "client/web/src/settings/SettingRow.tsx: text-[11px]",
      "client/web/src/settings/Settings.tsx: text-[10px]",
      "client/web/src/settings/Settings.tsx: text-[10px]",
      "client/web/src/settings/SharingSettings.tsx: text-[11.5px]",
      "client/web/src/settings/SharingSettings.tsx: text-[11px]",
      "client/web/src/sharing/AskToShare.tsx: text-[11px]",
      "client/web/src/sidebar/Header.tsx: text-[10px]",
      "client/web/src/sidebar/LaterPicker.tsx: text-[11px]",
      "client/web/src/sidebar/Rollup.tsx: text-[10px]",
      "client/web/src/sidebar/SectionView.tsx: text-[11px]",
      "client/web/src/tiling/AsidePill.tsx: text-[11px]",
      "client/web/src/tiling/Strip.tsx: text-[0.625rem]",
      "client/web/src/trust/TrustCard.tsx: text-[10px]",
      "platform/harnesses/pane/src/LimitsWidget.tsx: text-[11.5px]",
      "platform/harnesses/pane/src/LimitsWidget.tsx: text-[11.5px]",
      "platform/harnesses/pane/src/Spend.tsx: text-[11.5px]",
      "platform/harnesses/pane/src/Spend.tsx: text-[11.5px]",
      "platform/harnesses/pane/src/Spend.tsx: text-[11.5px]",
      "platform/harnesses/pane/src/Spend.tsx: text-[11.5px]",
      "platform/harnesses/pane/src/UsagePane.tsx: text-[11.5px]",
    ],
  },
  {
    rule: "design.10",
    why: "Step 2, Q2: 13 px goes up to `text-ui`.",
    cases: [
      "apps/agents/pane/src/entries/subagent.tsx: text-[13px]",
      "apps/agents/pane/src/entries/subagent.tsx: text-[13px]",
      "apps/agents/pane/src/thread/SubagentPane.tsx: text-[13px]",
      "apps/files/pane/src/Info.tsx: text-[13px]",
      "client/ui/src/components/thread-details.tsx: text-[13px]",
      "client/web/src/bar/Update.tsx: text-[13px]",
      "client/web/src/settings/MachinePicker.tsx: text-[13px]",
      "client/web/src/sidebar/Foot.tsx: text-[13px]",
      "client/web/src/sidebar/Foot.tsx: text-[13px]",
      "client/web/src/sidebar/GroupHeader.tsx: text-[13px]",
      "client/web/src/sidebar/Header.tsx: text-[13px]",
      "client/web/src/sidebar/Tabs.tsx: text-[13px]",
      "client/web/src/sidebar/ViewMenu.tsx: text-[13px]",
      "client/web/src/sidebar/ViewMenu.tsx: text-[13px]",
      "platform/harnesses/pane/src/Spend.tsx: text-[13px]",
      "platform/harnesses/pane/src/Spend.tsx: text-[13px]",
      "platform/harnesses/pane/src/UsagePane.tsx: text-[13px]",
    ],
  },
  {
    rule: "design.10",
    why: "Step 2: sizes between the levels go onto one: 12.5 px in the Usage Pane and the spend card, a small button's 0.8rem, a Question's 14.5 px, the Banda menu's 15 px.",
    cases: [
      "apps/agents/pane/src/asking/Questions.tsx: text-[0.90625rem]",
      "client/ui/src/components/button.tsx: text-[0.8rem]",
      "client/web/src/menu/BandaMenu.tsx: text-[15px]",
      "client/web/src/menu/BandaMenu.tsx: text-[15px]",
      "platform/harnesses/pane/src/Spend.tsx: text-[12.5px]",
      "platform/harnesses/pane/src/Spend.tsx: text-[12.5px]",
      "platform/harnesses/pane/src/Spend.tsx: text-[12.5px]",
      "platform/harnesses/pane/src/UsagePane.tsx: text-[12.5px]",
    ],
  },
  {
    rule: "design.10",
    why: "Step 2, Q3: the one number a Pane is about goes onto `text-figure`.",
    cases: [
      "platform/harnesses/pane/src/Spend.tsx: text-[40px]",
      "platform/harnesses/pane/src/UsagePane.tsx: text-[28px]",
    ],
  },
  {
    rule: "design.10",
    why: "Step 2: prose's size by its custom property becomes `text-prose`; a line height by number becomes its level's, or Tailwind's name.",
    cases: [
      "apps/agents/pane/src/entries/subagent.tsx: leading-[18px]",
      "apps/agents/pane/src/thread/Queue.tsx: text-(length:--prose-size)",
      "apps/agents/pane/src/thread/Queue.tsx: text-(length:--prose-size)",
      "apps/files/pane/src/views/table.tsx: leading-[26px]",
    ],
  },
  {
    rule: "design.10",
    why: "Step 2: Tailwind's other size names go onto the levels, and step 2 clears them: `text-base` onto `text-title` (shadcn's inputs, fields, cards and dialogs), `text-lg` and `text-xl` onto `text-heading` (Q3: the Settings page's title, the message box's headings).",
    cases: [
      "apps/agents/pane/src/settings/AccountPage.tsx: text-base",
      "apps/agents/pane/src/settings/ThreadSettings.tsx: text-lg",
      "apps/agents/pane/src/thread/Start.tsx: text-lg",
      "client/ui/src/components/card.tsx: text-base",
      "client/ui/src/components/dialog.tsx: text-base",
      "client/ui/src/components/field.tsx: text-base",
      "client/ui/src/components/input.tsx: text-base",
      "client/ui/src/components/prompt-blocks.tsx: text-lg",
      "client/ui/src/components/prompt-blocks.tsx: text-xl",
      "client/ui/src/components/textarea.tsx: text-base",
      "client/web/src/safe/Broke.tsx: text-base",
      "client/web/src/settings/Settings.tsx: text-xl",
      "client/web/src/settings/SignField.tsx: text-base",
    ],
  },
  {
    rule: "design.10",
    why: "Stays: the font view's specimen shows a font at sizes of its own.",
    cases: [
      "apps/files/pane/src/views/font.tsx: text-2xl",
      "apps/files/pane/src/views/font.tsx: text-2xl",
      "apps/files/pane/src/views/font.tsx: text-4xl",
    ],
  },
  {
    rule: "design.10",
    why: "Step 2: sizes as numbers in stylesheets and styles take the levels' tokens: streamdown's headings, footnotes, code and table cells, the diff's header, Mermaid's size.",
    cases: [
      "client/ui/src/components/code-diff.tsx: font-size: 11px !important",
      "client/ui/src/components/code-diff.tsx: font-size: 11px !important",
      "client/ui/src/components/code-diff.tsx: font-size: 12px !important",
      'client/ui/src/lib/diagram-look.ts: fontSize: "14px"',
      "client/ui/src/styles/globals.css: font-size: 0.6875rem",
      "client/ui/src/styles/globals.css: font-size: 0.75rem",
      "client/ui/src/styles/globals.css: font-size: 0.78125rem",
      "client/ui/src/styles/globals.css: font-size: 0.875em",
      "client/ui/src/styles/globals.css: font-size: 0.875rem",
      "client/ui/src/styles/globals.css: font-size: 1.125rem",
      "client/ui/src/styles/globals.css: font-size: 1rem",
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

/** Each case found, as `rule file: what`, with its refusal. */
const pairs = drawingFiles(root).flatMap((file) => {
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
