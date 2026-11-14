import { expect, test } from "vitest"
import { logoName, logoWords } from "./Mark"

test('the Mark is named by the state it shows, "Banda: Asks you", by another machine away while its Agents were at work, and "Quiet on" while Quiet is on', () => {
  const name = (...args: Parameters<typeof logoWords>) =>
    logoName(logoWords(...args))
  expect(name("asking", false)).toBe("Banda: Asks you")
  expect(name("working", false)).toBe("Banda: Working")
  expect(name("failed", true)).toBe("Banda: Failed, Quiet on")
  expect(name("rest", true)).toBe("Banda: Quiet on")
  expect(name("offline", false)).toBe("Banda: Offline")
  // Another machine away while its Agents were at work says which.
  expect(name("offline", false, "arc is away with Agents at work")).toBe(
    "Banda: arc is away with Agents at work"
  )
  expect(name("rest", false)).toBe("Banda")
})
