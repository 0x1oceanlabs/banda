import { describe, expect, test } from "vitest"
import { Ahead, SLOW } from "./ahead"

/** Types `keys` one by one from `at`, 10 ms apart; the time after. */
function type(ahead: Ahead, keys: string, at: number): number {
  for (const key of keys) ahead.typed(key, (at += 10))
  return at
}

/** An Ahead over a link of `ms` per answer that has seen one letter go
 * and come back: slow enough, it draws from then on. */
function linked(ms: number): Ahead {
  const ahead = new Ahead()
  ahead.typed("x", 0)
  ahead.heard("x", ms)
  return ahead
}

describe("the letters a terminal draws ahead of its machine (#1242)", () => {
  test("nothing shows until the machine sent one letter back as typed", () => {
    const ahead = new Ahead()
    type(ahead, "gi", 0)
    expect(ahead.text()).toBe("")
    ahead.heard("g", 160)
    expect(ahead.text()).toBe("i")
    type(ahead, "t ", 200)
    expect(ahead.text()).toBe("it ")
  })

  test("each letter the machine sends back leaves what still waits", () => {
    const ahead = linked(150)
    type(ahead, "git", 1_000)
    expect(ahead.text()).toBe("git")
    ahead.heard("gi", 1_170)
    expect(ahead.text()).toBe("t")
    ahead.heard("t", 1_180)
    expect(ahead.text()).toBe("")
  })

  test("a shell that paints what is typed still confirms it", () => {
    const ahead = linked(150)
    type(ahead, "ls", 1_000)
    ahead.heard("\u001b[1;32ml\u001b[0m", 1_160)
    expect(ahead.text()).toBe("s")
  })

  test("the machine is right: anything else it sends takes all back, and nothing shows until a letter comes back again", () => {
    const ahead = linked(150)
    type(ahead, "abc", 1_000)
    ahead.heard("a\u001b[2Kq", 1_160)
    expect(ahead.text()).toBe("")
    type(ahead, "d", 1_200)
    expect(ahead.text()).toBe("")
    ahead.heard("d", 1_360)
    type(ahead, "e", 1_400)
    expect(ahead.text()).toBe("e")
  })

  test("where the program sends nothing back, as at a password, nothing is ever shown", () => {
    const ahead = linked(150)
    ahead.typed("\r", 1_000)
    ahead.heard("\r\nPassword: ", 1_150)
    const at = type(ahead, "hunter2", 1_200)
    expect(ahead.text()).toBe("")
    ahead.over()
    type(ahead, "x", at + 5_010)
    expect(ahead.text()).toBe("")
  })

  test("any key that does not print, and a paste, start over", () => {
    for (const key of ["\r", "\u007f", "\u001b[D", "\u0003", "pasted words"]) {
      const ahead = linked(150)
      type(ahead, "ab", 1_000)
      ahead.typed(key, 1_030)
      expect(ahead.text()).toBe("")
      type(ahead, "c", 1_040)
      expect(ahead.text()).toBe("")
    }
  })

  test("it draws only over a link slow enough to feel, and stays on near the edge", () => {
    const quick = linked(SLOW - 1)
    type(quick, "a", 1_000)
    expect(quick.text()).toBe("")

    const slow = linked(SLOW)
    type(slow, "a", 1_000)
    expect(slow.text()).toBe("a")
    // An answer a little quicker does not turn it off; a quick link does.
    slow.heard("a", 1_010 + 45)
    type(slow, "b", 2_000)
    expect(slow.text()).toBe("b")
    for (let at = 2_010; slow.text() !== ""; at += 100) {
      slow.heard(slow.text(), at + 5)
      slow.typed("c", at + 100)
      if (at > 20_000) throw new Error("it never turned off")
    }
  })

  test("an answer slower than a link's is a program at work, and is not its measure", () => {
    const ahead = linked(20)
    ahead.typed("a", 1_000)
    ahead.heard("a", 5_000)
    type(ahead, "b", 6_000)
    expect(ahead.text()).toBe("")
  })
})
