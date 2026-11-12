import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { type Kind, kitSheets, look, makesNames, refusal } from "./look"

/** What `look` finds of `kind` in `source`. */
const of = (kind: Kind, source: string, names = false) =>
  look(source, { names })
    .filter((found) => found.kind === kind)
    .map(({ what }) => what)

test("each case comes with its kind, its rule and what to write instead", () => {
  expect(look(`<a className="text-[11px] pb-[5px]" />`)).toEqual([
    {
      kind: "type",
      rule: "design.10",
      what: "text-[11px]",
      instead:
        "is off the scale: write `text-small` inside a key, a tag, a count on an icon or a menu's label, else `text-meta`, or add a level to the theme",
    },
    expect.objectContaining({ kind: "length", rule: "design.13" }),
  ])
  expect(refusal(look(`<a className="text-[11px]" />`)[0])).toBe(
    "design.10: text-[11px] is off the scale: write `text-small` inside a key, a tag, a count on an icon or a menu's label, else `text-meta`, or add a level to the theme"
  )
  expect(
    look(`<a className="z-50 shadow-md bg-white rounded-md" />`).map(
      ({ rule }) => rule
    )
  ).toEqual(["design.4", "design.9", "design.11", "design.12"])
})

test("the check sees each corner that is no level, as a class, in CSS and in a style", () => {
  expect(
    of(
      "corner",
      `<a className="rounded-md rounded-[3px] rounded-[calc(var(--radius)-3px)]" />` +
        `<b className="rounded-[min(var(--radius-md),10px)] rounded-(--x) rounded bg-muted" />` +
        `<c className="rounded-card rounded-t-control hover:rounded-small rounded-full rounded-e-none rounded-[inherit] rounded-tile rounded-window" />\n` +
        `.d { border-radius: calc(var(--radius) * 0.6); border-top-left-radius: 2px }\n` +
        `.e { border-radius: var(--small-radius); border-end-end-radius: 0; border-radius: 9999px }\n` +
        `const f = { borderRadius: 3 }\n` +
        `// rounded up, and a rounded-md in a comment\n` +
        `/* border-radius: 4px */ const g = "https://rounded.example"`
    )
  ).toEqual([
    "rounded-md",
    "rounded-[3px]",
    "rounded-[calc(var(--radius)-3px)]",
    "rounded-[min(var(--radius-md),10px)]",
    "rounded-(--x)",
    "rounded",
    "border-radius: calc(var(--radius) * 0.6)",
    "border-top-left-radius: 2px",
    "borderRadius",
  ])
})

test("the check sees a colour literal, and not a token, tokens mixed or a colour worked out", () => {
  expect(
    of(
      "colour",
      `<a className="bg-white text-black/50 hover:bg-black/[3.5%] dark:bg-white/8 border-amber-500/10 shadow-black/20 bg-[#fff] text-[rgb(0_0_0)]" />\n` +
        `<b className="bg-muted text-foreground/10 bg-[color-mix(in_oklab,var(--x)_60%,transparent)] bg-[color-mix(in_oklab,var(--x),black)] bg-raised" />\n` +
        `const c = { fill: "#ABCDEF", stroke: "white", color: "red", kind: "redo" }\n` +
        `ctx.fillStyle = "rgba(72, 122, 191, 0.35)"; css = "hsl(0 0% 0%)"\n` +
        `.d { background: color-mix(in srgb, AccentColor, transparent 50%); caret-color: CanvasText; color: oklch(0.6 0.15 255) }\n` +
        `.e { mask: linear-gradient(#000 0 0); fill: color(srgb 1 1 1) }\n` +
        `const f = rgb(token(name)), g = \`rgb(\${r}, \${g}, \${b})\`, h = "oklch(from var(--primary) 0.93 c h)"\n` +
        `const i = color("--foreground"), j = theme.red, k = "&#123;", l = { color: currentColor }\n` +
        `.m[data-color="violet"], .n[data-tone='red'] { color: var(--x) }\n` +
        `// #fff in a comment, and bg-white too`
    )
  ).toEqual([
    "bg-white",
    "text-black/50",
    "bg-black/[3.5%]",
    "bg-white/8",
    "border-amber-500/10",
    "shadow-black/20",
    "#fff",
    "rgb(0_0_0)",
    "bg-[color-mix(in_oklab,var(--x),black)]",
    "#ABCDEF",
    "white",
    "red",
    "rgba(72, 122, 191, 0.35)",
    "hsl(0 0% 0%)",
    "AccentColor",
    "CanvasText",
    "oklch(0.6 0.15 255)",
    "#000",
    "color(srgb 1 1 1)",
  ])
})

test("a custom property defined in @banda/ui's stylesheets is a name, not a case", () => {
  const sheet =
    `:root {\n  --focus-shadow:\n    0 6px 16px -4px rgb(0 0 0 / 0.25),\n    0 1px 3px rgb(0 0 0 / 0.1);\n` +
    `  --woke-text: color-mix(in oklab, var(--woke) 60%, black);\n  --x: 13px;\n}\n` +
    `.a { box-shadow: var(--focus-shadow); color: var(--woke-text); z-index: 4 }`
  expect(look(sheet, { names: true }).map(({ what }) => what)).toEqual([
    "z-index: 4",
  ])
  expect(of("colour", sheet)).toEqual([
    "rgb(0 0 0 / 0.25)",
    "rgb(0 0 0 / 0.1)",
    "black",
  ])
})

test("the check sees a size as a number, and not a level, a colour or a size worked out", () => {
  expect(
    of(
      "type",
      `<a className="text-[11px] text-[0.8rem] text-[0.90625rem]/5 text-(length:--prose-size) text-[length:var(--x)] leading-[18px]" />\n` +
        `<b className="text-meta text-ui/6 text-(--group-color) text-[var(--sdm-c,inherit)] leading-none leading-(--prose-leading)" />\n` +
        `.c { font-size: 12px !important; line-height: 16px; font-size: var(--text-root); font-size: inherit }\n` +
        `.d { font-size: calc(var(--a) * var(--b)) }\n` +
        `const e = { fontSize: "14px" }, f = { fontSize: 13 }, g = { fontSize: size }, h: { fontSize: number }`
    )
  ).toEqual([
    "text-[11px]",
    "text-[0.8rem]",
    "text-[0.90625rem]",
    "text-(length:--prose-size)",
    "text-[length:var(--x)]",
    "leading-[18px]",
    "font-size: 12px !important",
    'fontSize: "14px"',
    "fontSize: 13",
  ])
  const instead = (source: string) => look(source)[0].instead
  expect(instead(`"text-[13px]"`)).toContain("`text-ui`")
  expect(instead(`"text-[11.5px]"`)).toContain("`text-meta`")
  expect(instead(`"text-[10.5px]"`)).toContain("`text-small`")
  expect(instead(`"text-[20px]"`)).toContain("`text-heading`")
  expect(instead(`"text-[40px]"`)).toContain("`text-figure`")
  expect(instead(`"text-[24px]"`)).toContain(
    "`text-figure` for the one number a Pane is about, else `text-heading`"
  )
  expect(instead(`"text-[12.5px]"`)).not.toContain("`text-code`")
  expect(instead(`"text-(length:--prose-size)"`)).toContain("`text-prose`")
})

test("Tailwind's size names are refused, and the refusal names the level", () => {
  expect(
    of(
      "type",
      `<a className="text-base md:text-lg text-xl text-2xl text-xs [&_svg]:text-sm text-sm/6 text-base-foreground prose-lg context-sm --text-sm" />`
    )
  ).toEqual([
    "text-base",
    "text-lg",
    "text-xl",
    "text-2xl",
    "text-xs",
    "text-sm",
    "text-sm",
  ])
  expect(look(`"text-base"`)[0].instead).toBe(
    "is Tailwind's size name: write `text-title`, or add a level to the theme"
  )
  expect(look(`"text-xs"`)[0].instead).toBe(
    "is Tailwind's size name: write `text-meta`, or add a level to the theme"
  )
  expect(look(`"text-sm/6"`)[0].instead).toBe(
    "is Tailwind's size name: write `text-ui`, or add a level to the theme"
  )
  expect(look(`"text-4xl"`)[0].instead).toContain("`text-heading`")
})

test("Banda UI's names are read where they are made, and the refusals name them", () => {
  const [{ instead: layer }] = look(`"z-10"`)
  for (const name of ["raised", "float", "sidebar", "drawer", "top", "carried"])
    expect(layer).toContain(`\`z-${name}\``)
  expect(look(`"rounded-md"`)[0].instead).toContain("`rounded-control`")
  expect(look(`"text-[length:var(--x)]"`)[0].instead).toContain("`text-meta`")
})

test("only @banda/ui's stylesheets and the kit's make names", () => {
  const styles = fileURLToPath(new URL("../styles/", import.meta.url))
  expect(makesNames(`${styles}globals.css`)).toBe(true)
  expect(makesNames(`${styles}tokens.test.ts`)).toBe(false)
  const kit = kitSheets()
  expect(kit.map((file) => file.split("/").pop())).toContain("kit.css")
  expect(kit.every(makesNames)).toBe(true)
  expect(makesNames(fileURLToPath(new URL("./look.ts", import.meta.url)))).toBe(
    false
  )
})

test("the check sees a shadow that is no elevation, and not a ring, a name or a colour", () => {
  expect(
    of(
      "shadow",
      `<a className="shadow shadow-md hover:shadow-lg shadow-[0_4px_18px_rgb(0_0_0/0.18)] drop-shadow-[0_1px_2px_rgb(0_0_0_/_0.3)] inset-shadow-xs text-shadow-sm" />\n` +
        `<b className="shadow-none shadow-float shadow-lift shadow-(--tile-shadow) shadow-[var(--x)] shadow-black/10 shadow-foreground/5 ring-1 transition-[scale,box-shadow]" />\n` +
        `<c className="shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--group-color)_28%,transparent)] shadow-[inset_0_0_30px_var(--primary)]" />\n` +
        `.d { box-shadow: inset 0 0 0 2px var(--focus); box-shadow: inset 3px 0 var(--ink); box-shadow: none }\n` +
        `.e { box-shadow: 0 1px 2px var(--x); text-shadow: 0 0 1px black; filter: drop-shadow(0 1px 2px var(--x)) }\n` +
        `const f = { boxShadow: "0 0 4px var(--x)" }, g = "a shadow-free page"`
    )
  ).toEqual([
    "shadow",
    "shadow-md",
    "shadow-lg",
    "shadow-[0_4px_18px_rgb(0_0_0/0.18)]",
    "drop-shadow-[0_1px_2px_rgb(0_0_0_/_0.3)]",
    "inset-shadow-xs",
    "text-shadow-sm",
    "shadow-[inset_0_0_30px_var(--primary)]",
    "box-shadow: 0 1px 2px var(--x)",
    "text-shadow: 0 0 1px black",
    "drop-shadow(0 1px 2px var(--x))",
    'boxShadow: "0 0 4px var(--x)"',
  ])
})

test("a shadow's colours are its case, on every line it takes; a ring in a literal colour is the colour's", () => {
  const source =
    `<a className="shadow-[0_4px_18px_rgb(0_0_0/0.18)]" />\n` +
    `.b { box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.07) }\n` +
    `.c { box-shadow:\n        0 0 1px\n        #f00 }`
  expect(look(source).map(({ kind, what }) => `${kind} ${what}`)).toEqual([
    "colour rgb(255 255 255 / 0.07)",
    "shadow shadow-[0_4px_18px_rgb(0_0_0/0.18)]",
    "shadow box-shadow: 0 0 1px #f00",
  ])
})

test("the check sees a layer by number, and not a named one, 0, -1 or auto", () => {
  expect(
    of(
      "layer",
      `<a className="z-10 hover:z-50 -z-10 z-[100] z-1" />\n` +
        `<b className="z-0 -z-1 z-auto z-raised z-float z-top z-(--layer) transition-[z-index]" />\n` +
        `.c { z-index: 4; z-index: 0; z-index: -1; z-index: auto; z-index: var(--x) }\n` +
        `const d = { zIndex: "1" }, e = { zIndex: 0 }, f: { zIndex: number }`
    )
  ).toEqual([
    "z-10",
    "z-50",
    "-z-10",
    "z-[100]",
    "z-1",
    "z-index: 4",
    'zIndex: "1"',
  ])
})

test("the check sees a length in a class's brackets off the 4 px grid, and not a step, a token or one on the grid", () => {
  expect(
    of(
      "length",
      `<a className="pb-[5px] -mt-[3px] gap-x-[22px] size-[0.9375rem] ml-[-0.3rem] w-[1.5px]" />\n` +
        `<b className="p-2 gap-1.5 h-[260px] min-w-[96px] w-(--sidebar-width) max-w-[calc(100%-24px)] max-[200px]:hidden border-[1.5px] ring-[3px] tracking-[-0.03em] inset-ring-[1.5px]" />\n` +
        `.c { padding: 5px }`
    )
  ).toEqual([
    "pb-[5px]",
    "-mt-[3px]",
    "gap-x-[22px]",
    "size-[0.9375rem]",
    "ml-[-0.3rem]",
    "w-[1.5px]",
  ])
})
