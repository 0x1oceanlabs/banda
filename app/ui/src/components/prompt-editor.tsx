import * as React from "react"
import { splitBlock } from "@tiptap/pm/commands"
import { TextSelection } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
import Document from "@tiptap/extension-document"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import { UndoRedo } from "@tiptap/extensions"
import { EditorContent, useEditor } from "@tiptap/react"
import { cn } from "cn"
import { docOf, offsetOf, posOf, textOf } from "@banda/ui/lib/prompt"

/** What a prompt editor's owner can do with it. */
export type PromptEditorHandle = {
  focus(): void
  /** Puts `text` in, the caret `caret` characters into it, at once. The
   * owner sets its value to `text` as well. */
  replace(text: string, caret: number): void
  /** Whether the caret is on the first line going `up`, or on the last
   * going down, so an arrow would leave the text. */
  atEdge(up: boolean): boolean
}

type PromptEditorProps = {
  /** The text, a line a paragraph. */
  value: string
  /** The text changed, as typed; `caret` is where the caret is in it. */
  onChange: (value: string, caret: number) => void
  /** The caret moved, `caret` characters into the text. */
  onCaret?: (caret: number) => void
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
 * string, as a textarea does, so its owner keeps the text. Enter is the
 * owner's to take, as to send; Shift+Enter starts a line.
 */
function PromptEditor({
  value,
  onChange,
  onCaret,
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
        latest.current.onKeyDown?.(event)
        if (event.defaultPrevented) return true
        if (event.key === "Enter" && event.shiftKey && !event.isComposing)
          return splitBlock(view.state, view.dispatch)
        return false
      },
      handlePaste(_: EditorView, event: ClipboardEvent) {
        latest.current.onPaste?.(event)
        return event.defaultPrevented
      },
    },
  }))

  const editor = useEditor({
    extensions: EXTENSIONS,
    ...setup,
    onUpdate({ editor: { state } }) {
      typed.current = textOf(state.doc)
      onChange(typed.current, offsetOf(state.doc, state.selection.head))
    },
    onSelectionUpdate({ editor: { state } }) {
      onCaret?.(offsetOf(state.doc, state.selection.head))
    },
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

  // A value its owner sets, rather than one typed, replaces the text,
  // the caret at its end as a textarea puts it; undo does not go back
  // past it.
  const replace = React.useCallback(
    (text: string, caret: number) => {
      typed.current = text
      const { state, view } = editor
      const doc = state.schema.nodeFromJSON(docOf(text))
      const tr = state.tr.replaceWith(0, state.doc.content.size, doc.content)
      tr.setSelection(TextSelection.create(tr.doc, posOf(tr.doc, caret)))
      tr.setMeta("addToHistory", false).setMeta("preventUpdate", true)
      view.dispatch(tr)
    },
    [editor]
  )
  React.useEffect(() => {
    if (value !== typed.current) replace(value, value.length)
  }, [replace, value])

  React.useImperativeHandle(
    ref,
    () => ({
      // At once, as a textarea does; tiptap's own focus waits a frame.
      focus: () => editor.view.focus(),
      replace,
      atEdge(up) {
        const { state, view } = editor
        const line = state.selection.$head.index(0)
        const last = up ? 0 : state.doc.childCount - 1
        return line === last && view.endOfTextblock(up ? "up" : "down")
      },
    }),
    [editor, replace]
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

/** What a prompt is made of: lines of text, and undo. */
const EXTENSIONS = [Document, Paragraph, Text, UndoRedo]

export { PromptEditor }
