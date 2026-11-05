import { fromHtml } from "hast-util-from-html"
import { describe, expect, it } from "vitest"
import { copiedOf } from "./markdown-copy"

const copied = (html: string) => copiedOf(fromHtml(html, { fragment: true }))
const markdown = (html: string) => copied(html)?.text

/** A reply as Streamdown and Banda draw it, trimmed to what Copy reads. */
const REPLY = `<div data-slot="markdown">
<p>Intro with <span data-streamdown="strong">bold</span>, <em>em</em>, <del>gone</del>,
<a href="file:///w/docs/notes.md" data-file="/w/docs/notes.md" data-kind="code" title="/w/docs/notes.md:3"><code data-streamdown="inline-code"><svg aria-hidden="true"></svg><span data-folder="">docs/</span>notes.md:3</code></a>,
<a href="file:///w/src/app.js" data-file="/w/src/app.js" data-kind="text">src/app.js</a>,
<a href="file:///w/docs/notes.md" data-file="/w/docs/notes.md" data-kind="named" data-written="docs/notes.md#L2"><span>the notes</span><span class="select-none">(notes.md)</span></a>
and <a href="https://example.com/x" data-streamdown="link" title="https://example.com/x Click"><span>a page</span><span class="ml-1 select-none">(example.com)</span></a>
cited<sup><a data-footnote-ref="true" href="#_r_1_-fn-n" id="_r_1_-fnref-n" data-place="">1</a></sup>, see <a href="#usage" data-place="">usage</a>
and <span data-written="docs/gone.md">a gone file</span>.</p>
<ul><li>one</li><li>two with <code>code</code></li></ul>
<ol><li>first</li><li>second</li></ol>
<blockquote><p>quoted line</p></blockquote>
<div data-streamdown="table-wrapper"><div><button title="Copy table"><svg></svg></button></div>
<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>
<div data-language="ts" data-streamdown="code-block"><div data-streamdown="code-block-header"><span>ts</span></div>
<div><div data-streamdown="code-block-actions"><button aria-label="Copy Code"><svg></svg></button></div></div>
<div data-streamdown="code-block-body"><pre class="language-ts"><code><span class="block"><span>const</span><span> a = 1</span></span><span class="block"><span>const b = 2</span></span></code></pre></div></div>
<p>Math <span class="katex"><span class="katex-mathml"><math><semantics><mrow><msup><mi>x</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">x2</span></span> inline.</p>
<span class="katex-display"><span class="katex"><span class="katex-mathml"><math display="block"><semantics><mrow><mi>y</mi></mrow><annotation encoding="application/x-tex">y = mx + b</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">y=mx+b</span></span></span>
<div class="contents" data-source="graph TD; A-->B&#10;"><div data-streamdown="mermaid-block"><div><span>mermaid</span></div><div><button>Zoom in</button></div><svg></svg></div></div>
<p><span class="contents" data-media="docs/shot.png" data-alt="shot"><button aria-label="Open shot.png"><img src="blob:x" alt="shot"></button></span>
<span class="contents" data-media="docs/clip.mp4" data-alt=""><span role="status">Loading clip.mp4…</span></span></p>
<section data-footnotes=""><h2 id="footnote-label" data-streamdown="heading-2">Notes</h2>
<ol><li id="_r_1_-fn-n">The note. <a data-footnote-backref="true" href="#_r_1_-fnref-n" data-place="">↩</a></li></ol></section>
</div>`

describe("copying a reply", () => {
  it("writes it back as Markdown", () => {
    expect(markdown(REPLY)).toBe(
      [
        "Intro with **bold**, *em*, ~~gone~~, `docs/notes.md:3`, src/app.js, [the notes](docs/notes.md#L2) and [a page](https://example.com/x) cited[^n], see [usage](#usage) and [a gone file](docs/gone.md).",
        "- one\n- two with `code`",
        "1. first\n2. second",
        "> quoted line",
        "| A | B |\n| - | - |\n| 1 | 2 |",
        "```ts\nconst a = 1\nconst b = 2\n```",
        "Math $x^2$ inline.",
        "$$\ny = mx + b\n$$",
        "```mermaid\ngraph TD; A-->B\n```",
        "![shot](docs/shot.png) ![](docs/clip.mp4)",
        "[^n]: The note.",
      ].join("\n\n")
    )
  })

  it("and as clean HTML, without the page's buttons, hints or titles", () => {
    const html = copied(REPLY)!.html
    expect(html).toMatch(/^<meta charset="utf-8">/)
    expect(html).toContain("<strong>bold</strong>")
    expect(html).toContain(
      '<pre><code class="language-ts">const a = 1\nconst b = 2\n</code></pre>'
    )
    expect(html).toContain('<code class="language-math math-inline">x^2</code>')
    expect(html).not.toMatch(
      /button|title=|example\.com\)|select-none|data-(file|place|written)/
    )
  })

  it("keeps a code block's words when its lines are text", () => {
    expect(
      markdown(
        `<div data-streamdown="code-block"><pre><code>one\ntwo</code></pre></div>`
      )
    ).toBe("```\none\ntwo\n```")
  })

  it("is nothing where nothing is written", () => {
    expect(copied(`<div><button>Copy</button><svg></svg></div>`)).toBeNull()
  })
})
