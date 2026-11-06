import { expect, test } from "vitest"
import {
  attachedOf,
  extensionFor,
  needsScripts,
  notebookOf,
  outputHtml,
  outputOf,
  plainText,
} from "./notebook"

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="

const book = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { language: "python", name: "python3" } },
  cells: [
    {
      cell_type: "markdown",
      source: ["# Title\n", "![dot](attachment:dot.png)"],
      attachments: { "dot.png": { "image/png": PNG } },
    },
    {
      cell_type: "code",
      execution_count: 3,
      source: ["import numpy as np\n", "np.arange(3)"],
      outputs: [
        {
          output_type: "stream",
          name: "stdout",
          text: ["loading\r50%\r100%\n", "done\n"],
        },
        {
          output_type: "execute_result",
          execution_count: 3,
          data: { "text/plain": ["array([0, 1, 2])"] },
          metadata: {},
        },
        {
          output_type: "display_data",
          data: {
            "image/png": PNG.slice(0, 20) + "\n" + PNG.slice(20),
            "text/plain": ["<Figure>"],
          },
          metadata: {},
        },
        {
          output_type: "display_data",
          data: {
            "text/html": ["<table><tr><td>1</td></tr></table>"],
            "text/plain": ["   a\n0  1"],
          },
          metadata: {},
        },
        {
          output_type: "error",
          ename: "ValueError",
          evalue: "bad",
          traceback: ["\u001b[0;31mValueError\u001b[0m: bad"],
        },
      ],
    },
    { cell_type: "code", execution_count: null, source: "", outputs: [] },
    { cell_type: "raw", source: "raw text" },
    { cell_type: "unknown", source: "" },
  ],
}

test("a notebook's cells map to markdown, code with the outputs it saved, and raw text", () => {
  const { language, cells } = notebookOf(book)
  expect(language).toBe("python")
  expect(cells.map((cell) => cell.kind)).toEqual([
    "markdown",
    "code",
    "code",
    "raw",
  ])
  const [markdown, code, unrun] = cells
  expect(markdown).toMatchObject({
    kind: "markdown",
    source: "# Title\n![dot](attachment:dot.png)",
  })
  if (markdown.kind !== "markdown") throw new Error()
  expect(markdown.attachments["dot.png"]).toBe(`data:image/png;base64,${PNG}`)
  if (code.kind !== "code" || unrun.kind !== "code") throw new Error()
  expect(code.count).toBe(3)
  expect(code.source).toBe("import numpy as np\nnp.arange(3)")
  expect(code.outputs).toEqual([
    { kind: "text", text: "100%\ndone\n", stream: "stdout" },
    { kind: "text", text: "array([0, 1, 2])" },
    { kind: "image", src: `data:image/png;base64,${PNG}`, mime: "image/png" },
    {
      kind: "html",
      html: "<table><tr><td>1</td></tr></table>",
      text: "   a\n0  1",
    },
    { kind: "text", text: "ValueError: bad", stream: "error" },
  ])
  expect(unrun.count).toBeNull()
})

test("an SVG output is drawn from its text, and HTML that needs scripts is told", () => {
  const svg = outputOf({
    output_type: "display_data",
    data: { "image/svg+xml": "<svg/>" },
  })
  expect(svg).toEqual({
    kind: "image",
    src: "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E",
    mime: "image/svg+xml",
  })
  expect(outputOf({ output_type: "update_display_data" })).toBeNull()
  expect(needsScripts('<div id="p"></div><script>plot()</script>')).toBe(true)
  expect(needsScripts("<table></table>")).toBe(false)
})

test("a notebook of another format is refused in words", () => {
  expect(() => notebookOf({ nbformat: 3, worksheets: [] })).toThrow(
    "nbformat 3"
  )
  expect(() => notebookOf([])).toThrow("not a notebook")
  expect(extensionFor("Python")).toBe("py")
  expect(extensionFor("brainfuck")).toBe("txt")
  expect(plainText("a\r\nb")).toBe("a\nb")
})

test("a markdown cell's pictures are linked by a name its holder draws, and an HTML output loses its styles and blank lines", () => {
  const { text, pictures } = attachedOf("![dot](attachment:dot.png)", {
    "dot.png": "data:image/png;base64,AA",
  })
  expect(text).toBe("![dot](.attachments/dot.png)")
  expect(pictures).toEqual({
    ".attachments/dot.png": "data:image/png;base64,AA",
  })
  expect(
    outputHtml(
      "<style scoped>td { x }</style>\n<table>\n\n<tr><td>1</td></tr>\n</table>\n"
    )
  ).toBe("<table>\n<tr><td>1</td></tr>\n</table>")
})
