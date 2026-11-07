import { describe, expect, it } from "vitest"
import { DEFAULT_WRITING } from "@banda/contract/terminal"
import { cursorOf } from "./theme"

describe("the cursor terminal.toml gives", () => {
  it("is its style and whether it blinks", () => {
    expect(cursorOf(DEFAULT_WRITING)).toEqual({ style: "block", blink: true })
    expect(
      cursorOf({ ...DEFAULT_WRITING, cursor: "bar", blink: false })
    ).toEqual({ style: "bar", blink: false })
  })
})
