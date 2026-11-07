/**
 * A file's bytes as hex rows (ADR 0073, decision 6): each row's offset,
 * its 16 bytes in hex, and the same as text, a dot for what does not
 * print. Pure, so plain tests cover it.
 */

/** Bytes a row shows. */
export const ROW = 16

/** How many hex digits a file of `size` bytes needs for its offsets:
 * eight at least, as `xxd` writes them. */
export function offsetDigits(size: number): number {
  return Math.max(8, Math.ceil(Math.log2(Math.max(size, 1)) / 4))
}

/** An offset as the rows write it: `0000a0f0`. */
export function offsetText(offset: number, digits: number): string {
  return offset.toString(16).padStart(digits, "0")
}

/** A byte in hex, as `0a`. */
export function hexOf(byte: number): string {
  return byte.toString(16).padStart(2, "0")
}

/** A byte as text: itself when it prints in ASCII, else a dot. */
export function charOf(byte: number): string {
  return byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : "·"
}

/** An offset as the Person types it: `4096`, `0x1000`, or hex that
 * holds a letter, `1f0a`; none for what is neither. */
export function parseOffset(text: string): number | null {
  const typed = text.trim().toLowerCase().replace(/[\s_]/g, "")
  if (!typed) return null
  if (/^\d+$/.test(typed)) return Number(typed)
  const hex = /^(?:0x|\$)?([0-9a-f]+)h?$/.exec(typed)
  if (!hex) return null
  const value = parseInt(hex[1], 16)
  return Number.isSafeInteger(value) ? value : null
}
