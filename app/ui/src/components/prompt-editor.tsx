import * as React from "react"
import { Slice } from "@tiptap/pm/model"
import { type EditorState, Selection, TextSelection } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
import Document from "@tiptap/extension-document"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import { Gapcursor, UndoRedo } from "@tiptap/extensions"
import { EditorContent, useEditor } from "@tiptap/react"
import { cn } from "cn"
import { newLine, PROMPT_BLOCKS } from "@banda/ui/components/prompt-blocks"
import { CodeBlock, codeKey, inCode } from "@banda/ui/components/prompt-code"
import { Chip } from "@banda/ui/components/prompt-chip"
import { PROMPT_MARKS } from "@banda/ui/components/prompt-marks"
import {
  chip,
  CHIP_MARK,
  type ChipKind,
  docOf,
  textOf,
  type Typing,
  typingIn,
} from "@banda/ui/lib/prompt"

export type { Typing }

/** What a prompt editor's owner can do with it. */
export type PromptEditorHandle = {
  focus(): void
  /** Puts `put` in place of the word being typed: text, or a chip and a
   * space after it; the caret goes after it. */
  complete(put: string | { chip: ChipKind; value: string }): void
  /** Whether the caret is on the first line going `up`, or on the last
   * going down, so an arrow would leave the text. */
  atEdge(up: boolean): boolean
}

type PromptEditorProps = {
  /** The text, a line a paragraph, a chip as what it writes, a style as
   * the markdown it was written with. */
  value: string
  /** The text changed, as typed. */
  onChange: (value: string) => void
  /** The word being typed that asks for suggestions, as the caret moves:
   * `/` at a line's start, or `@` at a word's. */
  onTyping?: (typing: Typing | undefined) => void
  /** Sees each key first; one it prevents goes no further. */
  onKeyDown?: (event: KeyboardEvent) => void
  /** Sees each paste first; one it prevents goes no further. */
  onPaste?: (event: ClipboardEvent) => void
  /** What the empty editor says. */
  placeholder?: string
  /** Attributes for its box, such as `aria-label` and those a list of
   * suggestions sets. */
  attributes?: Record<string, string | undefined>
  className?: string
  ref?: React.Ref<PromptEditorHandle>
}

/**
 * Where a prompt is written: a text box on tiptap (ADR 0015) that holds a
 * string, as a textarea does, so its owner keeps the text. What it points
 * at, such as a file, is a chip in it, and its markdown is styled as it
 * is typed. Enter is the owner's to take, as to send; Shift+Enter starts
 * a line.
 */
function PromptEditor({
  value,
  onChange,
  onTyping,
  onKeyDown,
  onPaste,
  placeholder,
  attributes,
  className,
  ref,
}: PromptEditorProps) {
  // ProseMirror's props are given once, so tiptap never sets them again;
  // the keys and pastes reach the latest handlers here.
  const latest = React.useRef({ onKeyDown, onPaste })
  React.useLayoutEffect(() => {
    latest.current = { onKeyDown, onPaste }
  })
  // The text last typed, so a value its owner sets is told apart.
  const typed = React.useRef(value)
  const [setup] = React.useState(() => ({
    content: docOf(value),
    editorProps: {
      handleKeyDown(view: EditorView, event: KeyboardEvent) {
        // In code, Enter and Tab are the code's, before the owner's.
        if (codeKey(view, event)) return true
        latest.current.onKeyDown?.(event)
        if (event.defaultPrevented) return true
        if (event.key === "Enter" && event.shiftKey && !event.isComposing)
          return newLine(view.state, view.dispatch)
        return false
      },
      // Pasted text is read as a prompt is, even from this box: its HTML
      // would lose how its lines and styles were written.
      handlePaste(view: EditorView, event: ClipboardEvent) {
        latest.current.onPaste?.(event)
        if (event.defaultPrevented) return true
        const text = event.clipboardData?.getData("text/plain")
        // Into code, ProseMirror puts the text as it is.
        if (!text || event.clipboardData?.files.length || inCode(view.state))
          return false
        paste(view, text)
        return true
      },
      // Copied, a chip is what it writes; dropped, that is a chip again.
      clipboardTextSerializer: (slice: Slice) => textOf(slice.content),
      clipboardTextParser: (
        text: string,
        _: unknown,
        __: boolean,
        view: EditorView
      ) => sliceOf(view, text),
    },
  }))

  // The word being typed, told only when it changes.
  const told = React.useRef<string>(undefined)
  const tell = (state: EditorState) => {
    const place = placeOf(state)
    const now = place && { trigger: place.trigger, word: place.word }
    const key = JSON.stringify(now)
    if (key === told.current) return
    told.current = key
    onTyping?.(now)
  }
  const editor = useEditor({
    extensions: EXTENSIONS,
    ...setup,
    onUpdate({ editor: { state } }) {
      typed.current = textOf(state.doc.content)
      onChange(typed.current)
    },
    onTransaction: ({ editor: { state } }) => tell(state),
  })

  const shown = JSON.stringify({
    role: "textbox",
    "aria-multiline": "true",
    ...attributes,
    "aria-placeholder": placeholder,
  })
  React.useEffect(() => {
    // JSON leaves out what is undefined, as ProseMirror wants.
    editor.view.setProps({ attributes: JSON.parse(shown) })
  }, [editor, shown])

  // A value its owner sets, rather than one typed, replaces the text, the
  // caret at its end as a textarea puts it; undo does not go back past it.
  React.useEffect(() => {
    if (value === typed.current) return
    typed.current = value
    const { state, view } = editor
    const doc = state.schema.nodeFromJSON(docOf(value))
    const tr = state.tr.replaceWith(0, state.doc.content.size, doc.content)
    tr.setSelection(TextSelection.atEnd(tr.doc))
    tr.setMeta("addToHistory", false).setMeta("preventUpdate", true)
    view.dispatch(tr)
  }, [editor, value])

  React.useImperativeHandle(
    ref,
    () => ({
      // At once, as a textarea does; tiptap's own focus waits a frame.
      focus: () => editor.view.focus(),
      complete(put) {
        const { state, view } = editor
        const typing = placeOf(state)
        if (!typing) return
        const { from, to } = typing
        const tr = state.tr
        if (typeof put === "string") tr.insertText(put, from, to)
        else {
          const made = state.schema.nodeFromJSON(chip(put.chip, put.value))
          tr.replaceWith(from, to, made)
          // One space after a chip, whether one was there or not.
          const after = from + made.nodeSize
          const next = tr.doc.textBetween(after, tr.doc.resolve(after).end())
          if (!/^\s/.test(next)) tr.insertText(" ", after)
          tr.setSelection(TextSelection.create(tr.doc, after + 1))
        }
        view.dispatch(tr)
        view.focus()
      },
      atEdge(up) {
        const { state, view } = editor
        const line = state.selection.$head.index(0)
        const last = up ? 0 : state.doc.childCount - 1
        return line === last && view.endOfTextblock(up ? "up" : "down")
      },
    }),
    [editor]
  )

  return (
    <div
      data-slot="prompt-editor"
      className={cn(
        "relative w-full min-w-0 overflow-y-auto px-2.5 py-2 text-base md:text-sm",
        className
      )}
    >
      {value === "" && placeholder && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-2.5 top-2 truncate text-muted-foreground"
        >
          {placeholder}
        </span>
      )}
      <EditorContent
        editor={editor}
        className="[&_.ProseMirror]:min-h-6 [&_.ProseMirror]:wrap-break-word [&_.ProseMirror]:whitespace-pre-wrap [&_.ProseMirror]:outline-none"
      />
    </div>
  )
}

/** The word being typed before the caret, if it asks for suggestions,
 * and where it is, its trigger included. */
function placeOf(
  state: EditorState
): (Typing & { from: number; to: number }) | undefined {
  const { empty, $head } = state.selection
  if (!empty || !$head.parent.isTextblock || $head.parent.type.spec.code)
    return undefined
  const { parent, parentOffset, pos } = $head
  const found = typingIn(parent.textBetween(0, parentOffset, "", CHIP_MARK))
  return found && { ...found, from: pos - found.word.length - 1, to: pos }
}

/** `text` as the lines it makes, open at their ends to join the line it
 * goes into. */
function sliceOf(view: EditorView, text: string) {
  const doc = view.state.schema.nodeFromJSON(docOf(text))
  return Slice.maxOpen(doc.content)
}

/** Puts `text` where the caret is; on a line of its own, its first line
 * keeps what it is, such as an item of a list. */
function paste(view: EditorView, text: string) {
  const { state } = view
  const { $from, empty } = state.selection
  const line = $from.parent
  const slice = sliceOf(view, text)
  const tr = state.tr
  if (empty && line.type.name === "paragraph" && line.content.size === 0) {
    tr.replaceWith($from.before(), $from.after(), slice.content)
    const end = $from.before() + slice.content.size
    tr.setSelection(Selection.near(tr.doc.resolve(end), -1))
  } else tr.replaceSelection(slice)
  view.dispatch(tr.scrollIntoView().setMeta("uiEvent", "paste"))
}

/** What a prompt is made of: lines, some of them headings, quotes, items
 * and rules, of styled text with chips; a caret beside a rule; undo. */
const EXTENSIONS = [
  Document,
  Paragraph,
  Text,
  Chip,
  ...PROMPT_MARKS,
  ...PROMPT_BLOCKS,
  CodeBlock,
  Gapcursor,
  UndoRedo,
]

export { PromptEditor }
