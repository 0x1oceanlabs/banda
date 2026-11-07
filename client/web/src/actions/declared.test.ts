/**
 * No Pane reads a key it does not declare (ADR 0071, decision 1): every
 * key Banda or an App answers is an action's, which `keys.toml` binds, but
 * for a widget's own as the platform has them (the arrows, Tab, Home,
 * End, Escape and Enter in lists, menus, dialogs and a field's
 * suggestions). This reads the window's and the modules' code for a key
 * compared by hand. What is left is named below with why, and only goes
 * down: a key made an action comes off the list.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { sources } from "@banda/ui/testing/architecture"
import ts from "typescript"
import { expect, test } from "vitest"

const root = join(import.meta.dirname, "../../../..")

/** The window's code: the page, its parts, and the modules' Panes. */
const folders = [
  join(root, "client/web/src"),
  join(root, "client/ui/src"),
  ...["apps", "platform"]
    .flatMap((bucket) =>
      readdirSync(join(root, bucket)).map((module) =>
        join(root, bucket, module, "pane/src")
      )
    )
    .filter((folder) => existsSync(folder)),
]

/** A widget's own keys, as the platform has them, and the mods' own. */
const WIDGET = new Set([
  "Escape",
  "Enter",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Tab",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Backspace",
  "Delete",
  // Space presses a tab, a button or a box, as Enter does.
  " ",
  "Shift",
  "Alt",
  "AltGraph",
  "Control",
  "Meta",
])

/** A key's name or code, as a press says it: what is compared with
 * `.key` or `.code` and is no key, as a refusal's code, is left alone. */
const KEYLIKE =
  /^(.|Key[A-Z]|Digit\d|Numpad\w+|F\d{1,2}|Arrow\w+|Bracket(Left|Right)|Slash|Backslash|Period|Comma|Semicolon|Quote|Backquote|Minus|Equal|Space|Enter|Escape|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|(Shift|Control|Alt|Meta|OS)(Left|Right)?|AltGraph|ContextMenu)$/

/** Where the keys in force are matched, which is their job. */
const MATCHERS = new Set([
  "client/web/src/actions/actions.ts",
  "client/ui/src/lib/keys.ts",
  // Main takes from a page the keys in force the window gave it.
  "apps/browser/pane/src/keys.ts",
  // The menu's rows run their actions by those actions' keys.
  "client/web/src/menu/BandaMenu.tsx",
])

/** The keys still read by hand, by file and key, and why. */
const LEFT: { readonly [place: string]: string } = {
  "apps/agents/pane/src/composer/Composer.tsx KeyV":
    "Ctrl+Shift+V pastes as plain text, as the platform's own paste does",
  "apps/files/pane/src/views/pdf.tsx KeyF":
    "a PDF's find waits for a scope of a file's Pane, files.file (ADR 0073)",
  "apps/files/pane/src/views/hex.tsx matches":
    "the bytes' Go to offset waits for a scope of a file's Pane, files.file (ADR 0073)",
  "apps/files/pane/src/views/edit.tsx matches":
    "the editor's E and Ctrl+S wait for a scope of a file's Pane, files.file (ADR 0073)",
  "apps/files/pane/src/views/json.tsx matches":
    "the JSON's copy of the value picked waits for a scope of a file's Pane, files.file (ADR 0073)",
}

/** Whether `node` reads a press's key or code: `event.key`. */
function readsKey(node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    (node.name.text === "key" || node.name.text === "code")
  )
}

/** Each key `text` reads by hand, by its file: `path KeyV`. */
function readKeys(path: string, text: string): string[] {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    false,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const found: string[] = []
  const literal = (node: ts.Node) =>
    ts.isStringLiteralLike(node) && KEYLIKE.test(node.text)
      ? node.text
      : undefined
  const visit = (node: ts.Node) => {
    // `event.key === "/"`, either way round.
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ].includes(node.operatorToken.kind)
    ) {
      const key =
        (readsKey(node.left) && literal(node.right)) ||
        (readsKey(node.right) && literal(node.left))
      if (key) found.push(key)
    }
    // `switch (event.key) { case "/": … }`
    if (ts.isSwitchStatement(node) && readsKey(node.expression))
      for (const clause of node.caseBlock.clauses) {
        const key = ts.isCaseClause(clause) && literal(clause.expression)
        if (key) found.push(key)
      }
    // The keys' own `matches(press, key)`, not an element's.
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "matches" &&
      !MATCHERS.has(path)
    )
      found.push("matches")
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found.filter((key) => !WIDGET.has(key)).map((key) => `${path} ${key}`)
}

test("no Pane reads a key it does not declare, but for a widget's own", () => {
  const read = new Set(
    folders
      .flatMap((folder) => sources(folder, { tests: false }))
      .flatMap((file) =>
        readKeys(relative(root, file), readFileSync(file, "utf8"))
      )
  )
  // A key read by hand is an action's to be (ADR 0071, decision 1).
  expect([...read].filter((place) => !(place in LEFT)).sort()).toEqual([])
  // One made an action comes off the list.
  expect(Object.keys(LEFT).filter((place) => !read.has(place))).toEqual([])
})
