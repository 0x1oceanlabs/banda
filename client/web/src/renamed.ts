/**
 * What the window kept under an old name moves to the new one, once,
 * before anything reads it: Bandaso is Banda now, and the sidebar's
 * Settled is its Archive (ADR 0069).
 */

/** A key that moves, and how its value changes on the way, if it does. */
type Move = { from: string; to: string; reshape?: (value: string) => string }

/** The Person's says of the sidebar: `{ settled, at }` is `{ archived, at }`. */
export function settledToArchived(value: string): string {
  try {
    const says = JSON.parse(value) as Record<
      string,
      { settled?: unknown; at?: unknown }
    >
    const renamed = Object.entries(says).map(([id, say]) => [
      id,
      { archived: say?.settled, at: say?.at },
    ])
    // A say of another shape is dropped as the archive reads it.
    return JSON.stringify(Object.fromEntries(renamed))
  } catch {
    return "{}"
  }
}

const BANDASO = "bandaso."

function moves(storage: Storage): Move[] {
  return [
    ...Object.keys(storage)
      .filter((key) => key.startsWith(BANDASO))
      .map((key) => ({ from: key, to: `banda.${key.slice(BANDASO.length)}` })),
    // After the Bandaso moves, which may have brought it here.
    {
      from: "banda.sidebar.settled",
      to: "banda.sidebar.archived",
      reshape: settledToArchived,
    },
  ]
}

// No window, as in a test: nothing kept to move.
if (typeof window !== "undefined") {
  for (const { from, to, reshape } of moves(localStorage)) {
    const value = localStorage.getItem(from)
    if (value === null) continue
    if (localStorage.getItem(to) === null) {
      localStorage.setItem(to, reshape ? reshape(value) : value)
    }
    localStorage.removeItem(from)
  }
}
