import * as React from "react"
import {
  type Fragment,
  type Node as ProseMirrorNode,
  Slice,
} from "@tiptap/pm/model"
import {
  type EditorState,
  Selection,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
import Document from "@tiptap/extension-document"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import { Gapcursor, UndoRedo } from "@tiptap/extensions"
import { EditorContent, useEditor } from "@tiptap/react"
import { cn } from "../lib/utils"
import {
  itemKey,
  newLine,
  PROMPT_BLOCKS,
} from "@banda/ui/components/prompt-blocks"
import { CodeBlock, codeKey, inCode } from "@banda/ui/components/prompt-code"
import { Chip } from "@banda/ui/components/prompt-chip"
import { PROMPT_MARKS, wrap } from "@banda/ui/components/prompt-marks"
import {
  chip,
  CHIP_MARK,
  type ChipKind,
  docOf,
  KINDS,
  NO_SKILLS,
  rechip,
  type Skills,
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
  /** Puts `text`, typed or pasted somewhere else, at the end, as pasted
   * text is read, the caret after it, and takes the focus. */
  add(text: string): void
  /** Puts a chip for the file at `path` at the caret, or at the end, as a
   * word of its own, and takes the focus. */
  point(path: string, at: "caret" | "end"): void
  /** Puts `text` on lines of its own after the caret's line, or in place
   * of it if it is empty; the caret goes to their end, and takes the
   * focus. */
  putLines(text: string): void
  /** What an editing menu may do now (ADR 0063, decision 3). */
  can(): { undo: boolean; redo: boolean; selected: boolean }
  /** Does it, as its key does, with the focus back in the text. */
  edit(act: EditAct): void
}

/** What an editing menu does to the text itself; the window pastes. */
export type EditAct = "undo" | "redo" | "cut" | "copy" | "selectAll"

type PromptEditorProps = {
  /** The text, a line a paragraph, a chip as what it writes, a style as
   * the markdown it was written with. */
  value: string
  /** The text changed, as typed. */
  onChange: (value: string) => void
  /** The names of the skills `$` names, each a chip in the text. */
  skills?: Skills
  /** The word being typed that asks for suggestions, as the caret moves:
   * `/` at a line's start, or `@` or `$` at a word's. */
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
  skills: known = NO_SKILLS,
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
  const latest = React.useRef({ onKeyDown, onPaste, known })
  React.useLayoutEffect(() => {
    latest.current = { onKeyDown, onPaste, known }
  })
  // The text last typed, so a value its owner sets is told apart.
  const typed = React.useRef(value)
  const [setup] = React.useState(() => ({
    content: docOf(value, known),
    editorProps: {
      handleKeyDown(view: EditorView, event: KeyboardEvent) {
        // The text's keys come before the owner's, but not while a word
        // being typed may have its suggestions open, which Enter and Tab
        // pick from.
        const suggesting = placeOf(view.state) !== undefined
        if (!suggesting && textKey(view, event)) return true
        latest.current.onKeyDown?.(event)
        if (event.defaultPrevented) return true
        if (suggesting && textKey(view, event)) return true
        if (event.key === "Enter" && event.shiftKey && !event.isComposing)
          return newLine(view.state, view.dispatch)
        return false
      },
      handleTextInput: wrap,
      // Pasted text is read as a prompt is, even from this box: its HTML
      // would lose how its lines and styles were written.
      handlePaste(view: EditorView, event: ClipboardEvent) {
        latest.current.onPaste?.(event)
        if (event.defaultPrevented) return true
        const text = event.clipboardData?.getData("text/plain")
        // Into code, ProseMirror puts the text as it is.
        if (!text || event.clipboardData?.files.length || inCode(view.state))
          return false
        paste(view, text, latest.current.known)
        return true
      },
      // Copied, a chip is what it writes; dropped, that is a chip again.
      clipboardTextSerializer: (slice: Slice) => textOf(slice.content),
      clipboardTextParser: (
        text: string,
        _: unknown,
        __: boolean,
        view: EditorView
      ) => sliceOf(view, text, latest.current.known),
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
    const doc = state.schema.nodeFromJSON(docOf(value, latest.current.known))
    const tr = state.tr.replaceWith(0, state.doc.content.size, doc.content)
    tr.setSelection(TextSelection.atEnd(tr.doc))
    tr.setMeta("addToHistory", false).setMeta("preventUpdate", true)
    view.dispatch(tr)
  }, [editor, value])

  // Skills the Harness says after the text was written make chips of
  // their names in it, and one it no longer has is text again.
  React.useEffect(() => {
    const tr = rechip(editor.state, known)
    if (tr) editor.view.dispatch(tr)
  }, [editor, known])

  React.useImperativeHandle(
    ref,
    () => ({
      // At once, as a textarea does; tiptap's own focus waits a frame.
      focus: () => editor.view.focus(),
      can: () => ({
        undo: editor.can().undo(),
        redo: editor.can().redo(),
        selected: !editor.state.selection.empty,
      }),
      edit(act) {
        editor.view.focus()
        if (act === "undo") editor.commands.undo()
        else if (act === "redo") editor.commands.redo()
        else if (act === "selectAll") editor.commands.selectAll()
        // The editor's own copy and cut, as the keys: chips copy as text.
        else document.execCommand(act)
      },
      complete(put) {
        const { state, view } = editor
        const typing = placeOf(state)
        if (!typing) return
        const { from, to } = typing
        const tr = state.tr
        if (typeof put === "string") tr.insertText(put, from, to)
        else putChip(tr, from, to, put.chip, put.value)
        view.dispatch(tr)
        view.focus()
      },
      atEdge(up) {
        const { state, view } = editor
        const line = state.selection.$head.index(0)
        const last = up ? 0 : state.doc.childCount - 1
        return line === last && view.endOfTextblock(up ? "up" : "down")
      },
      add: (text) => put(editor.view, text, "end", latest.current.known),
      point(path, at) {
        const { view } = editor
        if (at === "end") toEnd(view)
        const { state } = view
        // In code, what a chip writes is text.
        if (inCode(state)) return put(view, KINDS.file.write(path), "caret")
        const { from, to } = state.selection
        view.dispatch(putChip(state.tr, from, to, "file", path))
        view.focus()
      },
      putLines(text) {
        const { view } = editor
        const tr = view.state.tr
        putOwnLines(tr, sliceOf(view, text, latest.current.known).content)
        view.dispatch(tr.scrollIntoView())
        view.focus()
      },
    }),
    [editor]
  )

  // The text is prose, as the Thread's: sized by its Pane, not the window
  // (ADR 0058, decision 2). The placeholder sits where the text starts,
  // whatever the padding its owner gives.
  return (
    <div
      data-slot="prompt-editor"
      className={cn(
        "relative w-full min-w-0 overflow-y-auto px-2.5 py-2 text-prose",
        className
      )}
    >
      <div className="relative">
        {value === "" && placeholder && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 truncate text-muted-foreground"
          >
            {placeholder}
          </span>
        )}
        <EditorContent
          editor={editor}
          className="[&_.ProseMirror]:wrap-break-word [&_.ProseMirror]:whitespace-pre-wrap [&_.ProseMirror]:outline-none"
        />
      </div>
    </div>
  )
}

/**
 * A key the text takes: in code Enter and Tab are the code's, and in a
 * list Tab is the item's. Each takes a key only if it changes something,
 * so a Shift+Tab that moves nothing is the owner's, plan mode's.
 */
function textKey(view: EditorView, event: KeyboardEvent): boolean {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
    return false
  return codeKey(view, event) || itemKey(view, event)
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

/** Puts a chip of `kind` for `value` in place of `from` to `to`, a word of
 * its own: a space before it if the text before has none, and one after
 * it, whether one was there or not, the caret after that. */
function putChip(
  tr: Transaction,
  from: number,
  to: number,
  kind: ChipKind,
  value: string
): Transaction {
  const $from = tr.doc.resolve(from)
  const before = $from.parent.textBetween(0, $from.parentOffset, "", CHIP_MARK)
  const made = tr.doc.type.schema.nodeFromJSON(chip(kind, value))
  tr.replaceWith(from, to, made)
  let at = from
  if (before !== "" && !/\s$/.test(before)) tr.insertText(" ", at++)
  const after = at + made.nodeSize
  const next = tr.doc.textBetween(after, tr.doc.resolve(after).end())
  if (!/^\s/.test(next)) tr.insertText(" ", after)
  return tr.setSelection(TextSelection.create(tr.doc, after + 1))
}

/** Puts `text` at the caret, or at the end, as pasted text is read, or as
 * it is in code, and takes the focus. */
function put(
  view: EditorView,
  text: string,
  at: "caret" | "end",
  skills = NO_SKILLS
) {
  if (at === "end") toEnd(view)
  if (inCode(view.state)) view.dispatch(view.state.tr.insertText(text))
  else paste(view, text, skills)
  view.focus()
}

function toEnd(view: EditorView) {
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
}

/** `text` as the lines it makes, open at their ends to join the line it
 * goes into. */
function sliceOf(view: EditorView, text: string, skills = NO_SKILLS) {
  const doc = view.state.schema.nodeFromJSON(docOf(text, skills))
  return Slice.maxOpen(doc.content)
}

/** Puts `text` where the caret is; on a line of its own, its first line
 * keeps what it is, such as an item of a list. */
function paste(view: EditorView, text: string, skills: Skills) {
  const { state } = view
  const { $from, empty } = state.selection
  const line = $from.parent
  const slice = sliceOf(view, text, skills)
  const tr = state.tr
  if (empty && blank(line)) putOwnLines(tr, slice.content)
  else tr.replaceSelection(slice)
  view.dispatch(tr.scrollIntoView().setMeta("uiEvent", "paste"))
}

/** Puts `lines` on lines of their own: in place of the caret's line if it
 * is empty, else after it; the caret goes to their end. */
function putOwnLines(tr: Transaction, lines: Fragment) {
  const { $from, to } = tr.selection
  const line = $from.depth > 0 ? $from.parent : undefined
  const from = !line ? to : blank(line) ? $from.before() : $from.after()
  tr.replaceWith(from, line && blank(line) ? $from.after() : from, lines)
  tr.setSelection(Selection.near(tr.doc.resolve(from + lines.size), -1))
}

function blank(line: ProseMirrorNode): boolean {
  return line.type.name === "paragraph" && line.content.size === 0
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
