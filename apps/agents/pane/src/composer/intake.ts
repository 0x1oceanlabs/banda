/**
 * What joins the message besides typed text: files dropped, picked or
 * pasted, images as images and any other kept in the Project and named
 * in the text as `@` names a file; and a pasted text too long for the
 * box, kept as such a file.
 */
import { useRef } from "react"
import type { PromptEditorHandle } from "@banda/ui/components/prompt-editor"
import type { Attachments } from "./Attachments"
import { imagesAmong } from "./images"
import { long, pastedFile } from "./paste"

/** Where in the text a file taken is named: at the caret, or after all. */
export type At = "caret" | "end"

export function useIntake({
  field,
  images,
  keep,
  text,
}: {
  field: React.RefObject<PromptEditorHandle | null>
  images: Attachments
  /** Keeps a file in the Project; resolves its path, or nothing. */
  keep: (file: File) => Promise<string | undefined>
  /** What is written, for the name a long paste is kept under. */
  text: string
}) {
  // Whether the paste coming is Mod+Shift+V's, which pastes a long text as
  // text: the last key pressed, or the menu's item, says.
  const asText = useRef(false)

  /** Takes files into the message, each in turn. */
  const take = async (given: File[], at: At) => {
    const pictures = imagesAmong(given)
    if (pictures.length > 0) images.add(pictures)
    for (const file of given) {
      if (pictures.includes(file)) continue
      const path = await keep(file)
      if (path) field.current?.point(path, at)
    }
  }

  /** Takes from a paste what is not text for the box: files, and a text
   * too long for it, kept as a file; whether it took any. */
  const takePaste = (event: ClipboardEvent, at: At) => {
    const data = event.clipboardData
    if (!data) return false
    const pasted = data.getData("text/plain")
    // It holds for this paste alone.
    const asIs = asText.current
    asText.current = false
    if (data.files.length > 0) void take([...data.files], at)
    else if (!asIs && long(pasted)) void take([pastedFile(pasted, text)], at)
    else return false
    event.preventDefault()
    return true
  }

  /** Says whether the next paste is plain text, as Mod+Shift+V's is. */
  const pasteAsText = (plain: boolean) => {
    asText.current = plain
  }

  /** Hears a key pressed: Mod+Shift+V pastes as text. */
  const heardKey = (event: KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey
    asText.current = mod && event.shiftKey && event.code === "KeyV"
  }

  return { take, takePaste, pasteAsText, heardKey }
}
