/**
 * A Jupyter notebook as Files shows it (ADR 0073, decision 6): its cells,
 * markdown, code and raw, and the outputs it saved, each as the best of
 * its forms Files draws: a picture, HTML, markdown, or text. Nothing in
 * it runs. Pure, so plain tests cover it.
 */

/** What an output shows as. */
export type Output =
  | { kind: "text"; text: string; stream?: "stdout" | "stderr" | "error" }
  | { kind: "image"; src: string; mime: string }
  | { kind: "html"; html: string; text?: string }
  | { kind: "markdown"; text: string }

export type Cell =
  | {
      kind: "markdown"
      source: string
      /** Its pictures by name, as `attachment:name` links them: data
       * URLs. */
      attachments: Record<string, string>
    }
  | {
      kind: "code"
      source: string
      /** The count it ran as, when it was run. */
      count: number | null
      outputs: Output[]
    }
  | { kind: "raw"; source: string }

export type Notebook = {
  /** The kernel's language, as `python`. */
  language: string
  cells: Cell[]
}

/** What a field of a notebook holds: text, or text in lines. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value))
    return value.filter((one) => typeof one === "string").join("")
  return ""
}

/** A terminal's colours and moves, which an output may hold. */
// eslint-disable-next-line no-control-regex -- they start with ESC
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g

/** An output's text as it last showed: its colours gone, and a line
 * written over with a CR as it ended up. */
export function plainText(text: string): string {
  return text
    .replace(ANSI, "")
    .split("\n")
    .map((line) => {
      const whole = line.endsWith("\r") ? line.slice(0, -1) : line
      return whole.slice(whole.lastIndexOf("\r") + 1)
    })
    .join("\n")
}

/** The pictures Files draws, the best first. */
const PICTURES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]

/** A picture as a data URL: its base64 as kept, an SVG's text encoded. */
function pictureOf(mime: string, data: unknown): string | null {
  const text = textOf(data)
  if (!text) return null
  if (mime === "image/svg+xml")
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
  return `data:${mime};base64,${text.replace(/\s/g, "")}`
}

/** The best form of a display's data: a picture, HTML, markdown, JSON
 * or text. HTML that needs its scripts keeps its text beside it. */
function displayOf(data: unknown): Output | null {
  if (!data || typeof data !== "object") return null
  const forms = data as Record<string, unknown>
  for (const mime of PICTURES) {
    const src = mime in forms ? pictureOf(mime, forms[mime]) : null
    if (src) return { kind: "image", src, mime }
  }
  const plain =
    "text/plain" in forms ? plainText(textOf(forms["text/plain"])) : undefined
  if ("text/html" in forms)
    return {
      kind: "html",
      html: textOf(forms["text/html"]),
      ...(plain !== undefined && { text: plain }),
    }
  if ("text/markdown" in forms)
    return { kind: "markdown", text: textOf(forms["text/markdown"]) }
  if ("application/json" in forms)
    return {
      kind: "text",
      text: JSON.stringify(forms["application/json"], null, 2),
    }
  if ("text/latex" in forms)
    return { kind: "text", text: textOf(forms["text/latex"]) }
  return plain === undefined ? null : { kind: "text", text: plain }
}

/** One saved output, as Files shows it; none for one it has no form of. */
export function outputOf(output: unknown): Output | null {
  if (!output || typeof output !== "object") return null
  const one = output as Record<string, unknown>
  switch (one.output_type) {
    case "stream":
      return {
        kind: "text",
        text: plainText(textOf(one.text)),
        stream: one.name === "stderr" ? "stderr" : "stdout",
      }
    case "error": {
      const trace = Array.isArray(one.traceback)
        ? plainText(
            one.traceback.filter((line) => typeof line === "string").join("\n")
          )
        : ""
      return {
        kind: "text",
        text:
          trace ||
          `${String(one.ename ?? "Error")}: ${String(one.evalue ?? "")}`,
        stream: "error",
      }
    }
    case "execute_result":
    case "display_data":
      return displayOf(one.data)
    default:
      return null
  }
}

/** A markdown cell's pictures, by their names. */
function attachmentsOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {}
  const found: Record<string, string> = {}
  for (const [name, forms] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (!forms || typeof forms !== "object") continue
    for (const mime of PICTURES) {
      const src = pictureOf(mime, (forms as Record<string, unknown>)[mime])
      if (src) {
        found[name] = src
        break
      }
    }
  }
  return found
}

/** A notebook's cells and language, from its JSON; an error for one of
 * a format Files does not read: before nbformat 4, or none. */
export function notebookOf(json: unknown): Notebook {
  if (!json || typeof json !== "object")
    throw new Error("It is not a notebook.")
  const book = json as Record<string, unknown>
  const format = typeof book.nbformat === "number" ? book.nbformat : 0
  if (format < 4 || !Array.isArray(book.cells))
    throw new Error(
      format
        ? `It is of nbformat ${format}, which Files does not read: only 4.`
        : "It is not a notebook."
    )
  const meta = (book.metadata ?? {}) as Record<
    string,
    Record<string, unknown> | undefined
  >
  const language = String(
    meta.kernelspec?.language ?? meta.language_info?.name ?? "python"
  )
  const cells = book.cells.flatMap((raw): Cell[] => {
    if (!raw || typeof raw !== "object") return []
    const cell = raw as Record<string, unknown>
    const source = textOf(cell.source)
    switch (cell.cell_type) {
      case "markdown":
        return [
          {
            kind: "markdown",
            source,
            attachments: attachmentsOf(cell.attachments),
          },
        ]
      case "code":
        return [
          {
            kind: "code",
            source,
            count:
              typeof cell.execution_count === "number"
                ? cell.execution_count
                : null,
            outputs: (Array.isArray(cell.outputs) ? cell.outputs : []).flatMap(
              (output) => {
                const shown = outputOf(output)
                return shown ? [shown] : []
              }
            ),
          },
        ]
      case "raw":
        return [{ kind: "raw", source }]
      default:
        return []
    }
  })
  return { language, cells }
}

/** The extension a code cell of `language` is coloured as. */
export function extensionFor(language: string): string {
  const known: Record<string, string> = {
    python: "py",
    python3: "py",
    r: "r",
    julia: "jl",
    javascript: "js",
    typescript: "ts",
    scala: "scala",
    rust: "rs",
    go: "go",
    ruby: "rb",
    bash: "sh",
    sh: "sh",
    sql: "sql",
    "c++": "cpp",
    cpp: "cpp",
    c: "c",
    java: "java",
    kotlin: "kt",
    haskell: "hs",
    ocaml: "ml",
    lua: "lua",
  }
  return known[language.toLowerCase()] ?? "txt"
}

/** Whether an HTML output needs its scripts to show, which Files does not
 * run: its text shows instead, when it has one. */
export function needsScripts(html: string): boolean {
  return /<script\b/i.test(html)
}

/** Where a markdown cell's pictures are linked from, as a relative path
 * the markdown draws through its holder: `attachment:dot.png` names
 * `.attachments/dot.png`, which no file of the folder is asked for. */
export const ATTACHED = ".attachments/"

/** A markdown cell's source, its `attachment:` links named as the
 * pictures it keeps are, and those pictures by that name. */
export function attachedOf(
  source: string,
  attachments: Readonly<Record<string, string>>
): { text: string; pictures: Record<string, string> } {
  const pictures = Object.fromEntries(
    Object.entries(attachments).map(([name, src]) => [ATTACHED + name, src])
  )
  return { text: source.replace(/\battachment:/g, ATTACHED), pictures }
}

/** An HTML output as the page's markdown draws it, sanitized as a
 * reply's HTML is: its styles gone, which would show as text, and no
 * blank line left to end it early. */
export function outputHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\n\s*\n/g, "\n")
    .trim()
}
