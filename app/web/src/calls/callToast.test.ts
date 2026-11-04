import { toast } from "@banda/ui/components/sonner"
import { expect, test } from "vitest"
import { LIFE, toastCall } from "./callToast"
import type { Heard } from "./useCalls"

const heard = (chime: Heard["chime"], detail?: string): Heard => ({
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
  toastCall(heard("done"), true, () => {})
  toastCall(heard("asking", "May I?"), true, () => {})
  const shown = toast.getToasts().filter((one) => one.id === "s:t1")
  expect(shown).toHaveLength(1)
  expect(shown[0]).toMatchObject({
    title: "slow hello",
    description: "Asks you · May I?",
    duration: LIFE.asking,
  })
})

test("with detail off, a toast only names the call", () => {
  toastCall(heard("failed", "the tool broke"), false, () => {})
  const [shown] = toast.getToasts().filter((one) => one.id === "s:t1")
  expect(shown).toMatchObject({ description: "Failed" })
})
