import { toast } from "@banda/ui/components/sonner"
import type { Call } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { GO_TO, toldOfCall } from "./system"
import { LIFE, toastTold } from "./toast"

const call = (chime: Call["chime"], detail?: string): Call => ({
  about: "t1",
  chime,
  title: "slow hello",
  ...(detail ? { detail } : {}),
  pane: { kind: "agents.thread", args: {} },
  key: "s:t1",
  space: "s",
  since: 0,
})

test("a thing's new call replaces its toast, which lasts as long as the call is loud", () => {
  toastTold(toldOfCall(call("done"), true), () => {})
  toastTold(toldOfCall(call("asking", "May I?"), true), () => {})
  const shown = toast.getToasts().filter((one) => one.id === "s:t1")
  expect(shown).toHaveLength(1)
  expect(shown[0]).toMatchObject({
    title: "slow hello",
    duration: LIFE.asking,
  })
})

test("a call's toast says what calls, unless detail is off, and goes there", () => {
  expect(toldOfCall(call("asking", "May I?"), true)).toEqual({
    key: "s:t1",
    kind: "asking",
    title: "slow hello",
    body: "Asks you · May I?",
    buttons: [
      {
        label: "Answer",
        action: GO_TO,
        args: {
          space: "s",
          about: "t1",
          pane: { kind: "agents.thread", args: {} },
        },
      },
    ],
  })
  expect(toldOfCall(call("failed", "the tool broke"), false).body).toBe(
    "Failed"
  )
})
