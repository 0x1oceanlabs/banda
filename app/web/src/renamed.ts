/**
 * Bandaso is Banda now: what the window kept under the old name moves to the
 * new one, once, before anything reads it.
 */
const OLD = "bandaso."

for (const key of Object.keys(localStorage)) {
  if (!key.startsWith(OLD)) continue
  const renamed = `banda.${key.slice(OLD.length)}`
  const value = localStorage.getItem(key)
  if (value !== null && localStorage.getItem(renamed) === null) {
    localStorage.setItem(renamed, value)
  }
  localStorage.removeItem(key)
}
