import { useCallback, useEffect, useState } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import { nameAndFolder } from "@banda/ui/lib/paths"
import { useMenu } from "./Menu"

/** How long the typing rests before the files are asked for, in ms. */
const WAIT = 80

/** Finds the files in the Project's folder that hold the words. */
export type FindFiles = (query: string) => Promise<string[]>

/**
 * The files that fit what follows `@` in the composer, asked of the
 * engine as the Person types, in a list above its box as {@link useMenu}
 * shows one.
 */
export function useFileMenu({
  text,
  word: typed,
  findFiles,
  onPick,
}: {
  text: string
  /** What follows `@` before the caret, if a file's name is being typed. */
  word: string | undefined
  findFiles: FindFiles | undefined
  onPick: (path: string) => void
}) {
  const word = findFiles ? typed : undefined
  const found = useFoundFiles(word, findFiles)
  const answered = found?.word === word
  return useMenu({
    text,
    word,
    shown: found?.paths ?? [],
    label: "Files",
    empty: answered ? "No file holds that." : "Looking for files…",
    nameOf: (path) => path,
    render: (path) => {
      const { name, folder } = nameAndFolder(path)
      return { title: name, about: folder }
    },
    onPick,
  })
}

/**
 * The files that fit `word`, asked for once the typing rests; none is
 * asked while it is `undefined`. The files found last stay while the
 * next are asked for, with the word they were found for.
 */
export function useFoundFiles(
  word: string | undefined,
  findFiles: FindFiles | undefined
): { word: string; paths: string[] } | undefined {
  const [found, setFound] = useState<{ word: string; paths: string[] }>()
  useEffect(() => {
    if (word === undefined || !findFiles) return
    let gone = false
    const timer = setTimeout(() => {
      findFiles(word).then(
        (paths) => gone || setFound({ word, paths }),
        () => gone || setFound({ word, paths: [] })
      )
    }, WAIT)
    return () => {
      gone = true
      clearTimeout(timer)
    }
  }, [word, findFiles])
  return found
}

/** The files in the Project's folder that fit `word`, as `@` finds them. */
export function useProjectFiles(
  engine: Engine,
  project: ProjectId,
  word: string | undefined
): { word: string; paths: string[] } | undefined {
  return useFoundFiles(
    word,
    useCallback(
      (query: string) => engine.call("agents.files", { query }, { project }),
      [engine, project]
    )
  )
}
