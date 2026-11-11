/**
 * A Pane reaches the engine only through the API, and looks like the rest
 * of the window only through client/ui (docs/architecture.md, "Checks that
 * hold the shape").
 */
import { readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { imports, sources } from "@banda/ui/testing/architecture"
import { expect, test } from "vitest"

const PANE = [
  // The look and the settings contract too: the module's own files come
  // with the look, and it writes them (ADR 0016). The desktop bridge (ADR 0028), the Harnesses' words,
  // which its Threads run on (ADR 0040), and the files a reply's paths name
  // (ADR 0106, step 3c).
  /^@banda\/contract(\/agents|\/files|\/harnesses|\/look|\/settings|\/bridge)?$/,
  // The client's core, by the one door an App takes to it (ADR 0089).
  /^@banda\/core\/react$/,
  /^@banda\/ui\//,
  /^react$/,
  /^lucide-react$/,
  /^\.\.?\//,
]
/** A test may also read files and use its runner. */
const TEST = [...PANE, /^node:/, /^vitest$/]

test("the agents Panes import only the API, the core, client/ui and React", () => {
  const folder = import.meta.dirname
  // This file names imports as examples; it is not a Pane.
  const panes = sources(folder).filter((file) => file !== import.meta.filename)
  const outside = panes.flatMap((file) => {
    const allowed = /\.test\.tsx?$|testing\.ts$/.test(file) ? TEST : PANE
    return imports(readFileSync(file, "utf8"))
      .filter((name) => !allowed.some((rule) => rule.test(name)))
      .map((name) => `${relative(folder, file)}: ${name}`)
  })
  expect(outside).toEqual([])
})

test("entries/ and lines/ import no Pane API, ThreadPane or thread/Thread, and read no window.banda (ADR 0091, decision 7)", () => {
  const folder = import.meta.dirname
  const parts = ["entries", "lines"].flatMap((under) =>
    sources(join(folder, under), { tests: false })
  )
  const crossing = parts.flatMap((file) => {
    const source = readFileSync(file, "utf8")
    const named = imports(source)
      .filter(
        (name) =>
          name === "@banda/ui/pane" ||
          /\/ThreadPane$/.test(name) ||
          /\/thread\/Thread$/.test(name)
      )
      .map((name) => `${relative(folder, file)}: ${name}`)
    // Nor the Pane's words the core holds, as a Pane's host, imported or
    // passed on, by their own name or another.
    const fromCore = [
      ...source.matchAll(
        /\b(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"@banda\/core(?:\/react)?"/g
      ),
    ]
      .flatMap(([, names]) => names.split(","))
      .map((name) =>
        name
          .replace(/^\s*type\s+/, "")
          .replace(/\s+as\s+[\s\S]*$/, "")
          .trim()
      )
      .filter((name) => /^(?:PaneState|Place|paneHost|withHost)$/.test(name))
      .map((name) => `${relative(folder, file)}: ${name}`)
    return /\bwindow\.banda\b/.test(source)
      ? [...named, ...fromCore, `${relative(folder, file)}: window.banda`]
      : [...named, ...fromCore]
  })
  expect(crossing).toEqual([])
})

/**
 * The Person's marks go to a Thread's host only through list/sent.ts
 * (ADR 0096), which shows each at once until its fact comes back,
 * queues none while the host is away and sends each once, never again
 * after a break: no other file of the module sends one, so none goes
 * around that.
 */
test("only list/sent.ts sends a Thread's marks to its host", () => {
  const folder = import.meta.dirname
  const marking = /["'`]agents\.(?:read|unread|archive|unarchive)["'`]/
  const sending = sources(folder, { tests: false })
    .filter((file) => marking.test(readFileSync(file, "utf8")))
    .map((file) => relative(folder, file))
  expect(sending).toEqual([join("list", "sent.ts")])
})

/**
 * A Thread's sub-agents as its Pane places and words them are pure, the
 * same for every client (ADR 0103; ADR 0089, decision 1): no React, no
 * DOM, only the contract and other pure words.
 */
test("thread/subagents.ts imports only the contract and pure words", () => {
  const pure = [
    "@banda/contract/agents",
    "@banda/ui/lib/satellite",
    "@banda/ui/lib/words",
    "../asking/asking",
    "../entries/parts/calls",
    "../entries/parts/messageText",
    "./facts",
  ]
  const file = join(import.meta.dirname, "thread", "subagents.ts")
  const outside = imports(readFileSync(file, "utf8")).filter(
    (name) => !pure.includes(name)
  )
  expect(outside).toEqual([])
})

/** The words a source shows: its strings, its template literals, and
 * with `jsx` its JSX's text, without its comments; what an expression
 * puts in them reads "N". A plain reading, for the words test below. */
function shown(source: string, jsx: boolean): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
  const strings = [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)]
  const templates = [...code.matchAll(/`((?:[^`\\]|\\.)*)`/g)].map(
    ([, text]) => ["", text.replace(/\$\{[^}]*\}/g, "N")]
  )
  // JSX text runs from a tag or an expression to the next one; what
  // follows a comma is the next of a list.
  const text = jsx
    ? [...code.matchAll(/([>}])([^<>{}"`]+)([<{])/g)]
        .filter(([, , words]) => !/=>|[;=()]|^\s*,/.test(words))
        .map(([, from, words, to]) => [
          "",
          `${from === "}" ? "N" : ""}${words}${to === "{" ? "N" : ""}`,
        ])
    : []
  return [...strings, ...templates, ...text].map(([, words]) => words.trim())
}

/** "subagent" or "task" as a word on its own, not in a name as
 * `agents.subagent` or `group/subagents`. */
const WRONG = /(?<![\w/.-])(?:subagents?|tasks?)(?![\w/.-])/i

test("the Pane's words say sub-agent, never subagent or task (ADR 0103, decision 1)", () => {
  // Words a Person reads: a phrase, or one word that starts as a sentence.
  const said = (words: string) => /\s/.test(words) || /^[A-Z]/.test(words)
  const pane = import.meta.dirname
  const wrong = sources(pane, { tests: false }).flatMap((file) =>
    shown(readFileSync(file, "utf8"), file.endsWith(".tsx"))
      .filter((words) => said(words) && WRONG.test(words))
      .map((words) => `${relative(pane, file)}: ${words}`)
  )
  expect(wrong).toEqual([])
  // It finds them where they would be: a string, a template's text, and
  // JSX's text beside an expression.
  const planted = [
    '<span title="3 subagents">Stop the task</span>',
    "const head = `Ran ${n} subagents`",
    "<span>{n} subagents</span>",
    "<b>Tasks {n}</b>",
  ].join("\n")
  expect(shown(planted, true).filter((words) => WRONG.test(words))).toEqual([
    "3 subagents",
    "Ran N subagents",
    "Stop the task",
    "N subagents",
    "Tasks N",
  ])
})
