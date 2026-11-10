import {
  BandaMark,
  MARK_WORDS,
  type MarkState,
} from "@banda/ui/components/banda-mark"

/** The loudest mark of a group, and how many in it need the Person. */
export function Rollup({
  mark,
  waiting,
}: {
  mark: MarkState
  waiting: number
}) {
  return (
    <span className="flex items-center gap-1">
      {mark !== "rest" && (
        <BandaMark
          variant="agent"
          state={mark}
          playful={0}
          label={MARK_WORDS[mark]}
          className="size-3.5"
        />
      )}
      {waiting > 0 && (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-attention px-1 text-[10px] font-semibold text-background">
          {waiting}
        </span>
      )}
    </span>
  )
}
