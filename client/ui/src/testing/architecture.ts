/**
 * What the architecture tests read (docs/architecture.md, "Checks that
 * hold the shape"): the Apps' and platform parts' folders, the source
 * files of a folder, the modules each one names, the Apps each one names,
 * what each one takes of a module as values, where each one reads the
 * desktop's bridge, what each one animates and the props its components
 * take, those that are code and all of them; and for ADR 0106's laws 1
 * and 6, where a kind of Pane's code reaches past the handles it is given,
 * the kinds a file declares, and where code asks where its Pane is.
 * For tests alone: it reads the disk.
 */
/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, sep } from "node:path"
import ts from "typescript"

/**
 * The names of the file an App or a platform part declares itself in
 * beside its code, its manifest (ADR 0022): `app.toml` alone, since every
 * `module.toml` became one (ADR 0062, decision 11), so a folder left with
 * the old name is no part.
 */
export const MANIFEST_NAMES = ["app.toml"] as const

/** The manifest in `folder`, by its path; none when it has none. */
export function manifestIn(folder: string): string | undefined {
  return MANIFEST_NAMES.map((name) => join(folder, name)).find((file) =>
    existsSync(file)
  )
}

/**
 * Each App's and platform part's folder, by its id, its folder's name:
 * those of `apps/` and `platform/` under the repository's `root` with a
 * manifest (ADR 0062, decision 11). Finding none throws, as the kernel's
 * architecture test does, so a manifest renamed cannot leave the tests
 * that read the list checking nothing; one id in both throws, as the
 * engine's build does.
 */
export function parts(root: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const bucket of ["apps", "platform"])
    for (const id of readdirSync(join(root, bucket))) {
      const folder = join(root, bucket, id)
      if (!manifestIn(folder)) continue
      const other = found.get(id)
      if (other)
        throw new Error(`two folders are the part ${id}: ${other}, ${folder}`)
      found.set(id, folder)
    }
  if (found.size === 0)
    throw new Error(
      `no folder of apps/ or platform/ in ${root} has a manifest, ${MANIFEST_NAMES.join(" or ")}`
    )
  return found
}

/** Every `.ts` and `.tsx` file under `folder`, and `.css` with `styles`;
 * without tests when `tests` is false. */
export function sources(
  folder: string,
  { tests = true, styles = false }: { tests?: boolean; styles?: boolean } = {}
): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return sources(path, { tests, styles })
    if (!(styles ? /\.(tsx?|css)$/ : /\.tsx?$/).test(entry.name)) return []
    return tests || !entry.name.includes(".test.") ? [path] : []
  })
}

/** Every module a file names: `from "…"`, `import "…"`, `import("…")`.
 * A name is on one line, so words in a string, such as `key="forked-from"`,
 * are not taken for one. */
export function imports(source: string): string[] {
  const found = source.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"'\n]+)["']/g
  )
  return [...found].map((match) => match[1])
}

/**
 * What `source`, the code of `file`, says of an App (ADR 0087, decision
 * 1), once for each place it does: a string that names an action or a
 * kind of the agents module's (`agents.…`) or a Thread's (`thread.…`), a
 * template that starts so, and that module's settings file
 * (`AGENTS_FILE`). Read as TypeScript reads it, by the file's kind, so
 * comments and imports are not taken for a place.
 */
export function appStrings(source: string, file: string): string[] {
  const named = /^(agents|thread)\./
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return
    if (ts.isIdentifier(node) && node.text === "AGENTS_FILE")
      found.push(node.text)
    else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      named.test(node.text)
    )
      found.push(node.text)
    else if (ts.isTemplateExpression(node) && named.test(node.head.text))
      found.push(`${node.head.text}…`)
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest))
  return found
}

/** `node` without the brackets, casts and `!` around it. */
function bare(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
    ? bare(node.expression)
    : node
}

/** The names the page's global object goes by. */
const PAGE = ["window", "globalThis", "self"]

/** Whether `node` names the page's global object, in brackets or cast
 * as it may be. */
function isGlobal(node: ts.Expression): boolean {
  const it = bare(node)
  return ts.isIdentifier(it) && PAGE.includes(it.text)
}

/**
 * How many places `source`, the code of `file`, reads the desktop's
 * bridge (ADR 0089, decision 2): `window.banda`, `globalThis.banda`,
 * `self.banda`, `window["banda"]` and `const { banda } = window`, with
 * `?.` or without, and with `window` cast. Read as TypeScript reads it,
 * by the file's kind, so comments and the type that declares it are not
 * taken for a place.
 */
export function desktopReads(source: string, file: string): number {
  let found = 0
  const visit = (node: ts.Node): void => {
    if (
      (ts.isPropertyAccessExpression(node) &&
        isGlobal(node.expression) &&
        node.name.text === "banda") ||
      (ts.isElementAccessExpression(node) &&
        isGlobal(node.expression) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === "banda")
    )
      found++
    else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isGlobal(node.initializer)
    )
      for (const element of node.name.elements) {
        const name = element.propertyName ?? element.name
        if (ts.isIdentifier(name) && name.text === "banda") found++
      }
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest))
  return found
}

/** What lays the page out when it changes; `all` takes it in. */
const LAYOUT =
  /^(?:all|width|height|(?:min|max)-(?:width|height)|inset(?:-[a-z-]+)?|top|right|bottom|left|margin(?:-[a-z-]+)?|padding(?:-[a-z-]+)?|grid-template(?:-[a-z]+)?|flex-basis)$/

/**
 * What `source`, a source file or a stylesheet, animates that lays the
 * page out again on every tick (ADR 0088, decision 2), once for each place
 * it does: Tailwind's `transition-all` and `transition-[…]`, a CSS
 * `transition`, and `@keyframes` by what their steps set.
 */
export function layoutMotion(source: string): string[] {
  const found: string[] = []
  for (const [match] of source.matchAll(/(?<![\w-])transition-all(?![\w-])/g))
    found.push(match)
  for (const [match, list] of source.matchAll(
    /(?<![\w-])transition-\[([^\]\s]+)\]/g
  ))
    if (list.split(",").some((property) => LAYOUT.test(property)))
      found.push(match)
  // A CSS transition's properties come first in each of its parts.
  for (const [match, value] of source.matchAll(
    /(?<![\w-])transition(?:-property)?\s*:\s*([^;{}]+)/g
  ))
    if (
      value
        .split(",")
        .some((part) => LAYOUT.test(part.trim().split(/\s+/)[0] ?? ""))
    )
      found.push(match.trim())
  for (const start of source.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    let depth = 1
    let end = start.index + start[0].length
    while (depth && end < source.length) {
      if (source[end] === "{") depth++
      else if (source[end] === "}") depth--
      end++
    }
    const steps = source.slice(start.index + start[0].length, end)
    if (
      [...steps.matchAll(/(?<![\w-])([a-z-]+)\s*:/g)].some(([, property]) =>
        LAYOUT.test(property)
      )
    )
      found.push(`@keyframes ${start[1]}`)
  }
  return found
}

/**
 * A TypeScript program over `files`, with the compiler options of the
 * `tsconfig` file, for `componentProps` to read types by. It throws when
 * a file of it outside node_modules takes something of a module that is
 * not there (TS2307), as from a package a stale install left out: all it
 * would take is `any`, which no check can tell for code or data.
 */
export function programOver(files: string[], tsconfig: string): ts.Program {
  const said = (diagnostics: readonly ts.Diagnostic[]) =>
    diagnostics
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
      )
      .join("; ")
  const config = ts.getParsedCommandLineOfConfigFile(tsconfig, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(`${tsconfig}: ${said([diagnostic])}`)
    },
  })
  if (!config || config.errors.length > 0)
    throw new Error(`${tsconfig}: ${said(config?.errors ?? [])}`)
  const program = ts.createProgram(files, config.options)
  const checker = program.getTypeChecker()
  // Each module a file names, at the top or inside, as `import("…")`
  // does in a type or a call. `import "./look.css"` takes nothing, so
  // brings no `any`.
  const missing: string[] = []
  const visit = (node: ts.Node) => {
    const from =
      (ts.isImportDeclaration(node) && node.importClause) ||
      ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
          ? node.argument.literal
          : ts.isCallExpression(node) &&
              node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? node.arguments[0]
            : undefined
    if (from && ts.isStringLiteral(from) && !checker.getSymbolAtLocation(from))
      missing.push(`${node.getSourceFile().fileName}: ${from.text}`)
    ts.forEachChild(node, visit)
  }
  for (const tree of program.getSourceFiles())
    if (!tree.fileName.includes("/node_modules/")) visit(tree)
  if (missing.length > 0)
    throw new Error(
      `what these take would be any, as their module is not there (install again?): ${missing.join(", ")}`
    )
  return program
}

/**
 * What a component takes: every prop, and those of them that are code,
 * each by name, sorted.
 */
export interface Props {
  /** Every prop, whatever its type, and each it takes apart by name. */
  props: string[]
  /** The props that are code rather than data (ADR 0087, B4e): those
   * whose type, optional or not, can be called. */
  code: string[]
}

/**
 * The props of each component of `file`, a file of `program`, by the
 * component's name, read as TypeScript types them, wherever its props'
 * type is declared: a `Dispatch<…>`, a `VoidFunction` or a `typeof f` is
 * code as a function type written out is, and `Omit<ComponentProps<typeof
 * Row>, …>` brings Row's props. A component is a function whose name
 * starts with a capital, declared or held by a `const`, wrapped or not,
 * as by `memo`. Props typed `any`, all or one, throw, as they cannot be
 * told for code or data.
 */
export function componentProps(
  program: ts.Program,
  file: string
): Record<string, Props> {
  const tree = program.getSourceFile(file)
  if (!tree) throw new Error(`${file} is not a file of the program`)
  const checker = program.getTypeChecker()
  // A type can be called, also behind null or undefined, or as one of a
  // union's parts.
  const callable = (type: ts.Type): boolean => {
    const some = checker.getNonNullableType(type)
    return (some.isUnion() ? some.types : [some]).some(
      (part) => part.getCallSignatures().length > 0
    )
  }
  // Each name a component takes apart, bare or quoted (`onPin` or
  // `"onPin"`), with its type: its props' type may not name it, as an
  // index signature does not.
  const apart = (props: ts.ParameterDeclaration): [string, ts.Type][] =>
    ts.isObjectBindingPattern(props.name)
      ? props.name.elements.flatMap((element) => {
          const name = element.propertyName ?? element.name
          return !element.dotDotDotToken &&
            (ts.isIdentifier(name) || ts.isStringLiteral(name))
            ? [[name.text, checker.getTypeAtLocation(element)]]
            : []
        })
      : []
  const found: Record<string, Props> = {}
  const component = (name: string, fn: ts.SignatureDeclaration) => {
    if (!/^[A-Z]/.test(name)) return
    const props = fn.parameters[0]
    if (!props) {
      found[name] = { props: [], code: [] }
      return
    }
    const type = checker.getTypeAtLocation(props)
    if (type.flags & ts.TypeFlags.Any)
      throw new Error(
        `${file}: ${name}'s props are any, so none can be told for code or data`
      )
    const typed: [string, ts.Type][] = [
      ...checker
        .getPropertiesOfType(type)
        .map((prop): [string, ts.Type] => [
          prop.name,
          checker.getTypeOfSymbol(prop),
        ]),
      ...apart(props),
    ]
    // Sorted, as TypeScript gives the props an `Omit<…>` brings in the
    // order it first met their types, which another file can change.
    const names = (which: [string, ts.Type][]) =>
      [...new Set(which.map(([prop]) => prop))].toSorted()
    const loose = typed.filter(([, of]) => of.flags & ts.TypeFlags.Any)
    if (loose.length > 0)
      throw new Error(
        `${file}: ${name} takes ${names(loose).join(", ")} as any, which cannot be told for code or data`
      )
    found[name] = {
      props: names(typed),
      code: names(typed.filter(([, of]) => callable(of))),
    }
  }
  // The function a `const` holds, also inside a call such as `memo(…)`.
  const held = (node: ts.Expression): ts.SignatureDeclaration | undefined => {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node
    if (ts.isCallExpression(node) && node.arguments[0])
      return held(node.arguments[0])
    return undefined
  }
  for (const node of tree.statements)
    if (ts.isFunctionDeclaration(node) && node.name)
      component(node.name.text, node)
    else if (ts.isVariableStatement(node))
      for (const declaration of node.declarationList.declarations) {
        const fn = declaration.initializer && held(declaration.initializer)
        if (ts.isIdentifier(declaration.name) && fn)
          component(declaration.name.text, fn)
      }
  return found
}

/**
 * What `source`, the code of `file`, takes of each module it names, as a
 * value rather than a type, by the module: a relative one as the path it
 * stands for, without its extension, any other as written. A name is
 * taken as the module exports it, so `a` for `import { a as b }`, and
 * `default` for a default import; `*` takes the module whole (`import *
 * as m`, `export *`, `import("…")`). A re-export takes what it hands on,
 * as an import does; a type-only one, as `import type`, takes nothing.
 * Read as TypeScript reads it, so neither a comment nor a string is taken
 * for an import.
 */
export function valuesTaken(
  source: string,
  file: string
): Record<string, string[]> {
  const found: Record<string, string[]> = {}
  const take = (from: ts.Node | undefined, names: string[]) => {
    if (!from || !ts.isStringLiteralLike(from)) return
    const module = from.text.startsWith(".")
      ? join(dirname(file), from.text).replace(/\.[cm]?[jt]sx?$/, "")
      : from.text
    found[module] = [...(found[module] ?? []), ...names]
  }
  const named = (
    elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>
  ): string[] =>
    elements
      .filter((element) => !element.isTypeOnly)
      .map((element) => (element.propertyName ?? element.name).text)
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      if (clause?.phaseModifier === ts.SyntaxKind.TypeKeyword) return
      // `import "./x"` runs the module and takes nothing of it.
      if (!clause) return take(node.moduleSpecifier, [])
      const bound = clause.namedBindings
      take(node.moduleSpecifier, [
        ...(clause.name ? ["default"] : []),
        ...(bound && ts.isNamespaceImport(bound) ? ["*"] : []),
        ...(bound && ts.isNamedImports(bound) ? named(bound.elements) : []),
      ])
      return
    }
    if (ts.isExportDeclaration(node)) {
      if (node.isTypeOnly) return
      const clause = node.exportClause
      take(
        node.moduleSpecifier,
        !clause || ts.isNamespaceExport(clause) ? ["*"] : named(clause.elements)
      )
      return
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      take(node.moduleReference.expression, ["*"])
    else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    )
      take(node.arguments[0], ["*"])
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest))
  return found
}

/**
 * A module's name, as code names it, to its file of TypeScript in this
 * repository: a relative one from the file that names it, and one of the
 * workspace's `@banda/…` packages by its package's `exports`, as the
 * bundler finds it. None for a package from outside (React, lucide), a
 * stylesheet or a file that is not there: none is Banda's code to read.
 */
export function workspaceResolver(
  root: string
): (name: string, from: string) => string | undefined {
  // Each package of the workspace, by its name: those pnpm-workspace.yaml
  // lists all sit one or two folders down from these.
  const packages = new Map<string, { folder: string; exports: unknown }>()
  const look = (folder: string, depth: number) => {
    const file = join(folder, "package.json")
    if (existsSync(file)) {
      const { name, exports } = JSON.parse(readFileSync(file, "utf8")) as {
        name?: string
        exports?: unknown
      }
      if (name?.startsWith("@banda/")) packages.set(name, { folder, exports })
    }
    if (depth === 0) return
    for (const entry of readdirSync(folder, { withFileTypes: true }))
      if (entry.isDirectory() && entry.name !== "node_modules")
        look(join(folder, entry.name), depth - 1)
  }
  for (const top of ["sdk", "client", "apps", "platform"])
    if (existsSync(join(root, top))) look(join(root, top), 2)
  // A file as the bundler takes it: named whole, or without its
  // extension, or as a folder's index.
  const code = (path: string) =>
    [
      path,
      `${path}.ts`,
      `${path}.tsx`,
      join(path, "index.ts"),
      join(path, "index.tsx"),
    ].find((file) => /\.tsx?$/.test(file) && existsSync(file))
  // An export's target: a path, or the first path of its conditions.
  const target = (value: unknown): string | undefined =>
    typeof value === "string"
      ? value
      : value && typeof value === "object"
        ? Object.values(value).map(target).find(Boolean)
        : undefined
  return (name, from) => {
    if (name.startsWith(".")) return code(join(dirname(from), name))
    const [scope, base, ...rest] = name.split("/")
    const found = packages.get(`${scope}/${base}`)
    if (!found || typeof found.exports !== "object" || !found.exports)
      return undefined
    const sub = rest.length > 0 ? `./${rest.join("/")}` : "."
    for (const [key, value] of Object.entries(found.exports)) {
      const to = target(value)
      if (!to) continue
      if (key === sub) return code(join(found.folder, to))
      const star = key.indexOf("*")
      if (
        star >= 0 &&
        sub.startsWith(key.slice(0, star)) &&
        sub.endsWith(key.slice(star + 1))
      ) {
        const stem = sub.slice(star, sub.length - (key.length - star - 1))
        return code(join(found.folder, to.replace("*", stem)))
      }
    }
    return undefined
  }
}

/** The identifiers each binding of `name` declares, taken apart as it
 * may be. */
function bound(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name]
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bound(element.name)
  )
}

/** The names each binding of `name` gives. */
function boundNames(name: ts.BindingName): string[] {
  return bound(name).map((identifier) => identifier.text)
}

/** What `statements` declare in their own block, as a `const`, a
 * function, a class, an enum or an import does. */
function declaredIn(statements: readonly ts.Statement[]): ts.Identifier[] {
  return statements.flatMap((statement) => {
    if (ts.isVariableStatement(statement))
      return statement.declarationList.declarations.flatMap((declaration) =>
        bound(declaration.name)
      )
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    )
      return [statement.name]
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      const named = clause?.namedBindings
      return [
        ...(clause?.name ? [clause.name] : []),
        ...(named && ts.isNamespaceImport(named) ? [named.name] : []),
        ...(named && ts.isNamedImports(named)
          ? named.elements.map((element) => element.name)
          : []),
      ]
    }
    return []
  })
}

/**
 * What declares the name `identifier` says, of those its file declares
 * around it, as a parameter, a `const` or an import does: none for a
 * global. It reads the scopes a name is looked up in, not what TypeScript
 * would bind it to, so a `var` declared in an inner block of a function
 * is not seen.
 */
function bindingOf(identifier: ts.Identifier): ts.Identifier | undefined {
  const name = identifier.text
  const named = (identifiers: ts.Identifier[]) =>
    identifiers.find((one) => one.text === name)
  for (let node: ts.Node = identifier; node.parent; node = node.parent) {
    const scope = node.parent
    const found =
      ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope)
        ? named(declaredIn(scope.statements))
        : ts.isCaseBlock(scope)
          ? named(scope.clauses.flatMap((one) => declaredIn(one.statements)))
          : ts.isFunctionLike(scope)
            ? (named(scope.parameters.flatMap((one) => bound(one.name))) ??
              ((ts.isFunctionExpression(scope) ||
                ts.isClassExpression(scope)) &&
              scope.name?.text === name
                ? scope.name
                : undefined))
            : (ts.isForStatement(scope) ||
                  ts.isForInStatement(scope) ||
                  ts.isForOfStatement(scope)) &&
                scope.initializer &&
                ts.isVariableDeclarationList(scope.initializer)
              ? named(
                  scope.initializer.declarations.flatMap((one) =>
                    bound(one.name)
                  )
                )
              : ts.isCatchClause(scope) && scope.variableDeclaration
                ? named(bound(scope.variableDeclaration.name))
                : undefined
    if (found) return found
  }
  return undefined
}

/**
 * Whether `identifier` names something its file declares around it
 * (`bindingOf`), rather than the page's global of that name: a Pane's
 * `window` is often the Window's API (`WindowApi`), whose `open` opens a
 * Pane, not a browser's window.
 */
const shadowed = (identifier: ts.Identifier) =>
  bindingOf(identifier) !== undefined

/** Whether `node` is the page's own global of one of `names`, not
 * shadowed by a name of the file's: `window` and those that stand for it
 * (`PAGE`), `navigator`, `open`. */
function pageGlobal(node: ts.Expression, names: readonly string[]): boolean {
  const it = bare(node)
  return ts.isIdentifier(it) && names.includes(it.text) && !shadowed(it)
}

/** Whether `node` reads property `name` of `of`, by a dot or in brackets,
 * with `?.` or without. */
function reads(
  node: ts.Node,
  name: string
): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  return (
    (ts.isPropertyAccessExpression(node) && node.name.text === name) ||
    (ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === name)
  )
}

/** Whether `node` is the page's `navigator`: bare, or the window's. */
function navigatorOf(node: ts.Expression): boolean {
  const it = bare(node)
  return (
    pageGlobal(it, ["navigator"]) ||
    (reads(it, "navigator") && pageGlobal(it.expression, PAGE))
  )
}

/** A place in a file that reaches past what a Pane is given, and what
 * it reaches. */
export type Past = { what: PastHandle; line: number }

/**
 * What a Pane that opens on another machine reaches past its three
 * handles (ADR 0106, law 1): the desktop's bridge, by `@banda/ui`'s
 * typed part of it (`@banda/ui/desktop`, which `kindReaches` finds as an
 * import) or by `window.banda`; the device's clipboard; the browser's
 * windows; and an engine of its own.
 */
export const PAST_HANDLES = [
  "@banda/ui/desktop",
  "window.banda",
  "navigator.clipboard",
  "window.open",
  "new Engine",
] as const

export type PastHandle = (typeof PAST_HANDLES)[number]

/**
 * Each place `source`, the code of `file`, reaches past a Pane's handles
 * in its own code (`PAST_HANDLES`, but the import, which `kindReaches`
 * sees): `window.banda` and `globalThis.banda`, `navigator.clipboard` and
 * `window.navigator.clipboard`, also taken apart (`const { clipboard } =
 * navigator`), a call of `window.open` or of the global `open`, and `new
 * Engine`, by any name it is imported as, or a class that extends it. A
 * name the file declares around the place, as a parameter `window` that
 * is the Window's API, is not the page's global, so its `open` is no
 * place. Read as TypeScript reads it, by the file's kind, so
 * comments, strings and types are not taken for a place.
 */
export function pastHandles(source: string, file: string): Past[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  return placesIn(tree).map(({ what, line }) => ({ what, line }))
}

/** A place past the handles, with where it is in its file: its offset,
 * and whether it is inside a function, so runs only once called. */
type Place = Past & { at: number; called: boolean }

/** Whether `node` names the contract's `Engine`: by its name, off a
 * namespace, or by the name an import gives it (`import { Engine as E
 * }`). */
function engine(node: ts.Expression): boolean {
  const it = bare(node)
  if (reads(it, "Engine")) return true
  if (!ts.isIdentifier(it)) return false
  if (it.text === "Engine") return true
  const imported = bindingOf(it)?.parent
  return (
    !!imported &&
    ts.isImportSpecifier(imported) &&
    imported.propertyName?.text === "Engine"
  )
}

/** The places past a Pane's handles in `tree` (`pastHandles`). */
function placesIn(tree: ts.SourceFile): Place[] {
  const found: Place[] = []
  const at = (node: ts.Node, what: PastHandle) => {
    const start = node.getStart(tree)
    found.push({
      what,
      line: tree.getLineAndCharacterOfPosition(start).line + 1,
      at: start,
      called: inFunction(node),
    })
  }
  const visit = (node: ts.Node): void => {
    if (reads(node, "banda") && pageGlobal(node.expression, PAGE))
      at(node, "window.banda")
    else if (reads(node, "clipboard") && navigatorOf(node.expression))
      at(node, "navigator.clipboard")
    else if (ts.isCallExpression(node)) {
      const callee = bare(node.expression)
      if (
        (reads(callee, "open") && pageGlobal(callee.expression, PAGE)) ||
        pageGlobal(callee, ["open"])
      )
        at(node, "window.open")
    } else if (ts.isNewExpression(node)) {
      if (engine(node.expression)) at(node, "new Engine")
    } else if (
      ts.isHeritageClause(node) &&
      node.token === ts.SyntaxKind.ExtendsKeyword &&
      node.types.some((type) => engine(type.expression))
    ) {
      at(node, "new Engine")
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer
    ) {
      const taken = node.name.elements.map((element) => {
        const name = element.propertyName ?? element.name
        return ts.isIdentifier(name) ? name.text : undefined
      })
      if (taken.includes("banda") && pageGlobal(node.initializer, PAGE))
        at(node, "window.banda")
      if (taken.includes("clipboard") && navigatorOf(node.initializer))
        at(node, "navigator.clipboard")
      if (taken.includes("open") && pageGlobal(node.initializer, PAGE))
        at(node, "window.open")
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return found
}

/** Whether function `fn` may run as the code it sits in runs: handed to
 * a call, which may call it then (`watch(() => …)`, `lazy(() =>
 * import(…))`), or called where it is made. */
function handed(fn: ts.Node): boolean {
  let at = fn
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent
  const up = at.parent
  return (
    (ts.isCallExpression(up) || ts.isNewExpression(up)) &&
    (up.expression === at ||
      !!up.arguments?.some((argument) => argument === at))
  )
}

/** Whether `node` sits in a function of its file, so its code runs only
 * once that is called, not as the file loads. */
function inFunction(node: ts.Node): boolean {
  for (let up = node.parent; up && !ts.isSourceFile(up); up = up.parent) {
    // A class's static block runs as the class is made.
    if (ts.isClassStaticBlockDeclaration(up)) return false
    if (ts.isFunctionLike(up) && !handed(up)) return true
  }
  return false
}

/** One statement at the top of a file, as the kind checker reads it. */
type Unit = {
  /** The names it declares there. */
  declares: string[]
  /** Every name its code says, and those it says outside its functions,
   * which run as the file loads. */
  names: Set<string>
  loading: Set<string>
  /** Whether some of it runs as the file loads: a statement that is no
   * declaration, or a `const` made by a call. */
  runs: boolean
  /** The modules it imports by `import("…")`, with the line of each, and
   * whether that runs as the file loads. */
  later: { module: string; line: number; loading: boolean }[]
  places: Place[]
}

/** What the kind checker reads of one file. */
type Model = {
  units: Unit[]
  /** The units that declare each name. */
  declaring: Map<string, number[]>
  /** The values it imports, by the name its code says them by: the
   * module, and the name there (`default`, `*`). */
  bindings: Map<string, { module: string; name: string; line: number }>
  /** The modules it imports only to run them, `import "./x"`. */
  loads: { module: string; line: number }[]
  /** What it exports of its own, by the name it gives: the name inside. */
  own: Map<string, string>
  /** What it gives again of other modules by name, `export { a as b }
   * from "./x"`: by the name it gives, the module and the name there. */
  passes: Map<string, { module: string; name: string; line: number }>
  /** The modules it gives all of again, `export * from "./x"`. */
  all: { module: string; line: number }[]
}

/** Whether `node` calls or makes something outside its functions, so as
 * its file loads. */
function callsAsLoaded(node: ts.Node): boolean {
  if (
    ts.isCallExpression(node) ||
    ts.isNewExpression(node) ||
    ts.isTaggedTemplateExpression(node) ||
    ts.isAwaitExpression(node)
  )
    return true
  if (ts.isFunctionLike(node)) return false
  return ts.forEachChild(node, callsAsLoaded) ?? false
}

/** Whether `node` is a type, which runs nothing: but a class's `extends`,
 * which runs the class it names. */
function isType(node: ts.Node): boolean {
  if (!ts.isTypeNode(node)) return false
  const clause = node.parent
  return !(
    ts.isExpressionWithTypeArguments(node) &&
    ts.isHeritageClause(clause) &&
    clause.token === ts.SyntaxKind.ExtendsKeyword &&
    ts.isClassLike(clause.parent)
  )
}

/** Whether `at` is the name a declaration gives, which its code does
 * not say: else a `const` that runs as its file loads would take itself
 * whole then. */
function gives(at: ts.Identifier): boolean {
  const up = at.parent
  return (
    (ts.isVariableDeclaration(up) ||
      ts.isParameter(up) ||
      ts.isBindingElement(up) ||
      ts.isFunctionLike(up) ||
      ts.isClassLike(up) ||
      ts.isEnumDeclaration(up) ||
      ts.isEnumMember(up) ||
      ts.isPropertyDeclaration(up)) &&
    up.name === at
  )
}

/** Every name `node`'s code says, as a value or a component: not the name
 * after a dot, nor a key or an attribute, nor one in a type, nor the name
 * a declaration gives. With `loading`, only those outside its functions,
 * but a function handed to a call. */
function namesIn(node: ts.Node, loading: boolean): Set<string> {
  const found = new Set<string>()
  const visit = (at: ts.Node): void => {
    if ((loading && ts.isFunctionLike(at) && !handed(at)) || isType(at)) return
    if (ts.isIdentifier(at)) {
      const up = at.parent
      const after =
        (ts.isPropertyAccessExpression(up) && up.name === at) ||
        (ts.isPropertyAssignment(up) && up.name === at) ||
        (ts.isBindingElement(up) && up.propertyName === at) ||
        (ts.isJsxAttribute(up) && up.name === at) ||
        (ts.isQualifiedName(up) && up.right === at)
      if (!after && !gives(at)) found.add(at.text)
    }
    ts.forEachChild(at, visit)
  }
  visit(node)
  return found
}

/** Reads `source`, the code of `file`, for the kind checker. */
function modelOf(source: string, file: string): Model {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const lineOf = (node: ts.Node) =>
    tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1
  const model: Model = {
    units: [],
    declaring: new Map(),
    bindings: new Map(),
    loads: [],
    own: new Map(),
    passes: new Map(),
    all: [],
  }
  const places = placesIn(tree)
  const modifier = (node: ts.Node, kind: ts.SyntaxKind) =>
    ts.canHaveModifiers(node) &&
    !!ts.getModifiers(node)?.some((one) => one.kind === kind)
  for (const statement of tree.statements) {
    const unit: Unit = {
      declares: [],
      names: new Set(),
      loading: new Set(),
      runs: false,
      later: [],
      places: places.filter(
        ({ at }) => at >= statement.pos && at < statement.end
      ),
    }
    const exported = modifier(statement, ts.SyntaxKind.ExportKeyword)
    const byDefault = modifier(statement, ts.SyntaxKind.DefaultKeyword)
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      const from = statement.moduleSpecifier
      if (
        ts.isStringLiteralLike(from) &&
        clause?.phaseModifier !== ts.SyntaxKind.TypeKeyword
      ) {
        const module = from.text
        const line = lineOf(statement)
        const bound = clause?.namedBindings
        if (!clause) model.loads.push({ module, line })
        if (clause?.name)
          model.bindings.set(clause.name.text, {
            module,
            name: "default",
            line,
          })
        if (bound && ts.isNamespaceImport(bound))
          model.bindings.set(bound.name.text, { module, name: "*", line })
        if (bound && ts.isNamedImports(bound))
          for (const element of bound.elements)
            if (!element.isTypeOnly)
              model.bindings.set(element.name.text, {
                module,
                name: (element.propertyName ?? element.name).text,
                line,
              })
      }
    } else if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause
      const from = statement.moduleSpecifier
      if (statement.isTypeOnly) {
        // Types are no edge.
      } else if (!from) {
        if (clause && ts.isNamedExports(clause))
          for (const element of clause.elements)
            if (!element.isTypeOnly)
              model.own.set(
                element.name.text,
                (element.propertyName ?? element.name).text
              )
      } else if (ts.isStringLiteralLike(from)) {
        const line = lineOf(statement)
        if (!clause) model.all.push({ module: from.text, line })
        else if (ts.isNamespaceExport(clause))
          model.passes.set(clause.name.text, {
            module: from.text,
            name: "*",
            line,
          })
        else
          for (const element of clause.elements)
            if (!element.isTypeOnly)
              model.passes.set(element.name.text, {
                module: from.text,
                name: (element.propertyName ?? element.name).text,
                line,
              })
      }
    } else {
      if (ts.isExportAssignment(statement)) {
        unit.declares = ["default"]
        model.own.set("default", "default")
        unit.runs = callsAsLoaded(statement.expression)
      } else if (ts.isVariableStatement(statement)) {
        unit.declares = statement.declarationList.declarations.flatMap(
          (declaration) => boundNames(declaration.name)
        )
        unit.runs = statement.declarationList.declarations.some(
          (declaration) =>
            !!declaration.initializer && callsAsLoaded(declaration.initializer)
        )
      } else if (
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement)
      ) {
        // A default one keeps its own name too, which its file may say.
        const name = statement.name?.text
        unit.declares = [
          ...(byDefault ? ["default"] : []),
          ...(name ? [name] : []),
        ]
        unit.runs = ts.isEnumDeclaration(statement)
      } else if (!ts.isModuleDeclaration(statement)) unit.runs = true
      if (exported) for (const name of unit.declares) model.own.set(name, name)
      unit.names = namesIn(statement, false)
      unit.loading = namesIn(statement, true)
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments[0] &&
          ts.isStringLiteralLike(node.arguments[0])
        )
          unit.later.push({
            module: node.arguments[0].text,
            line: lineOf(node),
            loading: !inFunction(node),
          })
        ts.forEachChild(node, visit)
      }
      visit(statement)
    }
    for (const name of unit.declares)
      model.declaring.set(name, [
        ...(model.declaring.get(name) ?? []),
        model.units.length,
      ])
    model.units.push(unit)
  }
  return model
}

/** A place a kind's code reaches past its handles, and how: the files
 * from the kind's own to the one with the place, each taken by the one
 * before. */
export type Reached = Past & { file: string; chain: string[] }

/**
 * Each place the code of a kind of Pane reaches past its handles (ADR
 * 0106, law 1, `PAST_HANDLES`): in `start`, the file that declares the
 * kind, and in all it takes as values, through every import,
 * `@banda/ui`'s helpers included (`resolve`, `workspaceResolver`'s), but
 * not the core or the contract, which are the platform's and held by
 * their own ratchets, nor a package from outside. Of each file it takes
 * what the kind's code reaches: the declarations at its top it names,
 * and all they name in turn, and what runs as the file loads; so a
 * function of the same file that the kind never names is not its code,
 * nor is the rest of an `index.ts` it takes one name of.
 * `@banda/ui/desktop` is the place itself where its import is taken, and
 * is not read further. Types are no edge.
 *
 * It is a lint: it reads names as written, so it cannot see what code
 * reaches dynamically, by a computed name (`window[name]`), a value
 * handed in from outside (a callback that opens a window), `eval` or a
 * global another file set; nor a global by another name (`const w =
 * window`, `window.top`), `open` taken as a value and called later, or
 * another machine's session asked of the core (`useEngineOf()`), which
 * it does not read. A name the code says that its file declares twice,
 * or that a local variable shadows, it takes for the top's, so it may
 * take more than runs, never less.
 */
export function kindReaches(
  start: string,
  resolve: (name: string, from: string) => string | undefined,
  {
    name = "*",
    read = (file) => readFileSync(file, "utf8"),
  }: {
    /** What `start` exports the kind as: all of the file by default. */
    name?: string
    read?: (file: string) => string
  } = {}
): Reached[] {
  const desktop = resolve("@banda/ui/desktop", start)
  // The core and the contract are the platform's, which has no device
  // (ADR 0089, decision 1, as the window's architecture test holds): they
  // make the sessions a Pane is given as its handles, and the bridge, so
  // their code is not the kind's.
  const platform = ["@banda/core", "@banda/contract"].flatMap((name) => {
    const index = resolve(name, start)
    return index ? [dirname(index) + sep] : []
  })
  const models = new Map<string, Model>()
  const modelFor = (file: string) => {
    let known = models.get(file)
    if (!known) models.set(file, (known = modelOf(read(file), file)))
    return known
  }
  // Of each file reached: the names asked of it, the units that run as it
  // loads, and those its code reaches whole.
  const asked = new Map<string, Set<string>>()
  const loaded = new Map<string, Set<number>>()
  const reached = new Map<string, Set<number>>()
  const found: Reached[] = []
  // Each import of `@banda/ui/desktop` is one place, whatever it takes.
  const imported = new Set<string>()
  // `""` asks a file only to load, as `import "./x"` does.
  const work: { file: string; name: string; chain: string[] }[] = [
    { file: start, name, chain: [start] },
  ]
  const ask = (
    from: string,
    module: string,
    name: string,
    line: number,
    chain: string[]
  ) => {
    const file = resolve(module, from)
    if (!file || platform.some((folder) => file.startsWith(folder))) return
    if (file !== desktop) work.push({ file, name, chain: [...chain, file] })
    else if (!imported.has(`${from}:${line}`)) {
      imported.add(`${from}:${line}`)
      found.push({ what: "@banda/ui/desktop", line, file: from, chain })
    }
  }
  /** Takes unit `index` of `file`: whole, or only what runs as the file
   * loads; and all of the file its code names, and of other files. */
  const take = (
    file: string,
    index: number,
    whole: boolean,
    chain: string[]
  ) => {
    const model = modelFor(file)
    const todo: [number, boolean][] = [[index, whole]]
    for (let next = 0; next < todo.length; next++) {
      const [at, all] = todo[next]
      const taken = (all ? reached : loaded).get(file)!
      if (taken.has(at) || (!all && reached.get(file)!.has(at))) continue
      taken.add(at)
      const unit = model.units[at]
      for (const place of unit.places)
        if (all ? place.called || !loaded.get(file)!.has(at) : !place.called)
          found.push({ what: place.what, line: place.line, file, chain })
      for (const name of all ? unit.names : unit.loading) {
        const binding = model.bindings.get(name)
        if (binding)
          ask(file, binding.module, binding.name, binding.line, chain)
        for (const other of model.declaring.get(name) ?? [])
          todo.push([other, true])
      }
      for (const later of unit.later)
        if (all || later.loading)
          ask(file, later.module, "*", later.line, chain)
    }
  }
  for (let next = 0; next < work.length; next++) {
    const { file, name, chain } = work[next]
    const model = modelFor(file)
    let seen = asked.get(file)
    if (!seen) {
      // Reached at all, it loads: what runs then runs.
      asked.set(file, (seen = new Set()))
      loaded.set(file, new Set())
      reached.set(file, new Set())
      model.units.forEach(
        (unit, index) => unit.runs && take(file, index, false, chain)
      )
      for (const load of model.loads)
        ask(file, load.module, "", load.line, chain)
    }
    if (seen.has(name) || name === "") continue
    seen.add(name)
    const passed = model.passes.get(name)
    const inside = model.own.get(name)
    if (name !== "*" && passed)
      ask(file, passed.module, passed.name, passed.line, chain)
    else if (name !== "*" && inside !== undefined) {
      const binding = model.bindings.get(inside)
      if (binding) ask(file, binding.module, binding.name, binding.line, chain)
      for (const index of model.declaring.get(inside) ?? [])
        take(file, index, true, chain)
    } else if (name !== "*" && model.all.length > 0)
      for (const star of model.all)
        ask(file, star.module, name, star.line, chain)
    else {
      // All of it: asked for whole, or for a name it does not say it has.
      model.units.forEach((_, index) => take(file, index, true, chain))
      for (const [, passed] of model.passes)
        ask(file, passed.module, passed.name, passed.line, chain)
      for (const star of model.all)
        ask(file, star.module, "*", star.line, chain)
    }
  }
  return found
}

/**
 * The kinds of Pane `source`, the code of `file`, declares: each
 * `definePane({ kind: "…" })` held by a `const` at the top, by its kind's
 * ID, with the name the `const` holds it by, which is what the file
 * exports it as.
 */
export function kindsIn(
  source: string,
  file: string
): { kind: string; name: string }[] {
  // Most of the page declares none, and parsing it all would be slow.
  if (!source.includes("definePane")) return []
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  return tree.statements.filter(ts.isVariableStatement).flatMap((statement) =>
    statement.declarationList.declarations.flatMap((declaration) => {
      const made = declaration.initializer && bare(declaration.initializer)
      if (
        !ts.isIdentifier(declaration.name) ||
        !made ||
        !ts.isCallExpression(made) ||
        !ts.isIdentifier(made.expression) ||
        made.expression.text !== "definePane"
      )
        return []
      const [given] = made.arguments
      const kind =
        given &&
        ts.isObjectLiteralExpression(given) &&
        given.properties.find(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === "kind"
        )?.initializer
      return kind && ts.isStringLiteralLike(kind)
        ? [{ kind: kind.text, name: declaration.name.text }]
        : []
    })
  )
}

/**
 * Each place `source`, the code of `file`, asks where its Pane is (ADR
 * 0106, law 6: no Pane asks where it is; it asks what can run), by what
 * it says there:
 *
 * - its args' `host`, as `args.host`: `args.host`, `props.args.host`,
 *   `args["host"]`, `const { host } = args`, and `{ args: { host } }`
 *   taken apart in a parameter;
 * - Here's Pane's, as `pane.host`: `here.pane.host`, `….pane?.host`,
 *   `const { host } = here.pane`;
 * - the core's `paneHost(…)`, which reads the first;
 * - and each check of what one of those gave, by the name the file keeps
 *   it in, and the names kept of what is worked out of those in turn:
 *   `host` after `const { host } = args`, `here` after `const here =
 *   host === undefined`.
 *
 * So a branch that goes takes its place with it. A name is followed
 * within its file, by the scopes it is looked up in; what a call, a
 * function or a literal makes of it, or what it is handed on as, a prop
 * or in a context, is followed no further.
 */
export function hostReads(source: string, file: string): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  // What `node` is read off: `args` or `….args`, `….pane`.
  const of = (node: ts.Expression): "args" | "pane" | undefined => {
    const it = bare(node)
    if ((ts.isIdentifier(it) && it.text === "args") || reads(it, "args"))
      return "args"
    return reads(it, "pane") ? "pane" : undefined
  }
  // The `host` a pattern takes apart, as the name it keeps it by.
  const hostIn = (pattern: ts.ObjectBindingPattern) =>
    pattern.elements.flatMap((element) => {
      const name = element.propertyName ?? element.name
      return ts.isIdentifier(name) && name.text === "host"
        ? bound(element.name)
        : []
    })
  // The places that read a host, and the names that keep what they read.
  const hosts = new Map<ts.Node, string>()
  const kept = new Set<ts.Identifier>()
  const visit = (node: ts.Node): void => {
    if (reads(node, "host")) {
      const read = of(node.expression)
      if (read) hosts.set(node, `${read}.host`)
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer
    ) {
      const read = of(node.initializer)
      const names = hostIn(node.name)
      if (read && names.length > 0) {
        hosts.set(node.name, `${read}.host`)
        for (const name of names) kept.add(name)
      }
    } else if (
      ts.isBindingElement(node) &&
      node.propertyName !== undefined &&
      ts.isIdentifier(node.propertyName) &&
      node.propertyName.text === "args" &&
      ts.isObjectBindingPattern(node.name)
    ) {
      const names = hostIn(node.name)
      if (names.length > 0) {
        hosts.set(node.name, "args.host")
        for (const name of names) kept.add(name)
      }
    } else if (ts.isCallExpression(node)) {
      const callee = bare(node.expression)
      if (ts.isIdentifier(callee) && callee.text === "paneHost")
        hosts.set(node, "paneHost")
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  // Most files read none, and nothing can keep what none read.
  if (hosts.size === 0) return []
  // Whether `node`'s value is worked out of a host: it reads one, or
  // says a name that keeps one, but not in a function, a call or a
  // literal, which make something else of it.
  const says = (node: ts.Node): boolean =>
    hosts.has(node) ||
    (ts.isIdentifier(node) && kept.has(bindingOf(node)!)) ||
    (!ts.isFunctionLike(node) &&
      !ts.isCallExpression(node) &&
      !ts.isNewExpression(node) &&
      !ts.isObjectLiteralExpression(node) &&
      !ts.isArrayLiteralExpression(node) &&
      !ts.isJsxElement(node) &&
      !ts.isJsxSelfClosingElement(node) &&
      (ts.forEachChild(node, says) ?? false))
  // What a `const` works out of one keeps one too, until none is new.
  const declarations: ts.VariableDeclaration[] = []
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer)
      declarations.push(node)
    ts.forEachChild(node, collect)
  }
  collect(tree)
  for (let grew = true; grew;) {
    grew = false
    for (const declaration of declarations)
      if (says(declaration.initializer!))
        for (const name of bound(declaration.name))
          if (!kept.has(name)) {
            kept.add(name)
            grew = true
          }
  }
  // Each check of a name kept: a name said, not the one declared.
  const found = [...hosts.values()]
  const checks = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      !kept.has(node) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    ) {
      const binding = bindingOf(node)
      if (binding && kept.has(binding)) found.push(node.text)
    }
    ts.forEachChild(node, checks)
  }
  checks(tree)
  return found
}
