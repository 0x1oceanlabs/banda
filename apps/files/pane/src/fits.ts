/**
 * Whether a path found for other words fits the words typed since, as the
 * menu shows it until `files.find` answers these. Pure, so plain tests
 * cover it.
 */

/** Whether a path fits `words` as `files.find` (nucleo) would match it:
 * each word's letters in order, the case ignored unless one is a capital.
 * Never more than nucleo finds: words with its signs (`^ ' ! $ \`) fit
 * none until the engine says. */
export function fits(words: string): (path: string) => boolean {
  if (/[\^'!$\\]/.test(words)) return () => false
  const atoms = words.split(/\s+/).filter(Boolean)
  return (path) =>
    atoms.every((atom) =>
      inOrder(atom === atom.toLowerCase() ? path.toLowerCase() : path, atom)
    )
}

/** Whether `letters` are all in `text`, in their order. */
function inOrder(text: string, letters: string): boolean {
  let at = 0
  for (const letter of letters) {
    at = text.indexOf(letter, at)
    if (at === -1) return false
    at += letter.length
  }
  return true
}
