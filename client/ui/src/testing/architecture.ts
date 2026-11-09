/**
 * What the architecture tests read (docs/architecture.md, "Checks that
 * hold the shape"): the Apps' and platform parts' folders, the source
 * files of a folder, the modules each one names, the Apps each one names,
 * what each one takes of a module as values, where each one reads the
 * desktop's bridge, what each one animates and the props its components
 * take, those that are code and all of them.
 * For tests alone: it reads the disk.
 */
/// <reference types="node" />
import { existsSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
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

/** Whether `node` names the page's global object, in brackets or cast
 * as it may be. */
function isGlobal(node: ts.Node): boolean {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    return isGlobal(node.expression)
  return (
    ts.isIdentifier(node) &&
    (node.text === "window" ||
      node.text === "globalThis" ||
      node.text === "self")
  )
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
