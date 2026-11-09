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
 * The props of each component of `source`, the code of `file`, by the
 * component's name: with `code`, those whose type is a function, also
 * when optional or behind a type alias or an interface of the file, and
 * otherwise every one, whatever its type, and each it takes apart by
 * name. A component is a function whose name starts with a capital,
 * declared or held by a `const`, wrapped or not, as by `memo`. What its
 * props' type takes from elsewhere, as `Omit<ComponentProps<typeof Row>,
 * …>` takes Row's, is not read here: read the file that declares it.
 */
function componentProps(
  source: string,
  file: string,
  code: boolean
): Record<string, string[]> {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest)
  const declared = new Map<string, ts.Node>()
  for (const node of tree.statements)
    if (ts.isTypeAliasDeclaration(node)) declared.set(node.name.text, node.type)
    else if (ts.isInterfaceDeclaration(node)) declared.set(node.name.text, node)
  // What a type stands for, through the file's aliases, once each.
  const resolved = (type: ts.Node, seen: Set<string>): ts.Node => {
    if (ts.isParenthesizedTypeNode(type)) return resolved(type.type, seen)
    // A name, as a type or as what an interface extends.
    const named = ts.isTypeReferenceNode(type)
      ? type.typeName
      : ts.isExpressionWithTypeArguments(type)
        ? type.expression
        : undefined
    if (named && ts.isIdentifier(named)) {
      const target = declared.get(named.text)
      if (target && !seen.has(named.text))
        return resolved(target, new Set([...seen, named.text]))
    }
    return type
  }
  const isFunction = (type: ts.Node): boolean => {
    const node = resolved(type, new Set())
    if (ts.isFunctionTypeNode(node)) return true
    return ts.isUnionTypeNode(node) && node.types.some(isFunction)
  }
  // A name, bare or quoted: `onPin` or `"onPin"`.
  const nameOf = (name: ts.Node | undefined): string[] =>
    name && (ts.isIdentifier(name) || ts.isStringLiteral(name))
      ? [name.text]
      : []
  // Each type once, so an interface that extends itself ends.
  const members = (type: ts.Node, seen = new Set<ts.Node>()): string[] => {
    const node = resolved(type, new Set())
    if (seen.has(node)) return []
    seen.add(node)
    if (ts.isIntersectionTypeNode(node))
      return node.types.flatMap((part) => members(part, seen))
    if (!ts.isTypeLiteralNode(node) && !ts.isInterfaceDeclaration(node))
      return []
    // An interface of the file takes the members of those it extends.
    const extended = ts.isInterfaceDeclaration(node)
      ? (node.heritageClauses ?? []).flatMap((clause) =>
          clause.types.flatMap((base) => members(base, seen))
        )
      : []
    const own = node.members.flatMap((member) => {
      if (!code || ts.isMethodSignature(member)) return nameOf(member.name)
      return ts.isPropertySignature(member) &&
        member.type &&
        isFunction(member.type)
        ? nameOf(member.name)
        : []
    })
    return [...extended, ...own]
  }
  // What a component takes apart by name, its type read here or not.
  const apart = (props: ts.ParameterDeclaration | undefined): string[] =>
    props && ts.isObjectBindingPattern(props.name)
      ? props.name.elements.flatMap((element) =>
          element.dotDotDotToken
            ? []
            : nameOf(element.propertyName ?? element.name)
        )
      : []
  const found: Record<string, string[]> = {}
  const component = (name: string, fn: ts.SignatureDeclaration) => {
    if (!/^[A-Z]/.test(name)) return
    const props = fn.parameters[0]
    const typed = props?.type ? members(props.type) : []
    found[name] = [...new Set(code ? typed : [...typed, ...apart(props)])]
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
 * The props of each component of `source`, the code of `file`, that are
 * code rather than data (ADR 0087, B4e), by the component's name: those
 * whose type is a function, also when optional or behind a type alias or
 * an interface of the file (`componentProps` says what a component is
 * and what is read).
 */
export function functionProps(
  source: string,
  file: string
): Record<string, string[]> {
  return componentProps(source, file, true)
}

/**
 * Every prop of each component of `source`, the code of `file`, by the
 * component's name, whatever its type: its props' type's members, through
 * the file's aliases and interfaces, and each it takes apart by name. A
 * prop typed by a name from elsewhere, as `VoidFunction` or
 * `Dispatch<…>`, which `functionProps` cannot tell for code, is here too.
 */
export function propNames(
  source: string,
  file: string
): Record<string, string[]> {
  return componentProps(source, file, false)
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
