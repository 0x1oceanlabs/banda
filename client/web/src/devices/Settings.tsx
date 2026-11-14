/**
 * Settings → Devices (ADR 0124, decisions 3 and 4; SE5): the devices the
 * machine picked under "Settings for" lets in at its door, as that
 * machine keeps them, and Remove, which cuts one from it at once, or from
 * every machine the window reaches. A device joins by asking at a door:
 * the window asks the Person then (`AskingDialog.tsx`), so nothing here adds
 * one.
 */
import { useCallback, useEffect, useState } from "react"
import type { PairedDevice } from "@banda/contract/devices"
import { Button } from "@banda/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import { Empty, EmptyDescription, EmptyTitle } from "@banda/ui/components/empty"
import { RadioGroup } from "@banda/ui/components/radio-group"
import { Group, Rows } from "@banda/ui/components/setting-row"
import { toast } from "@banda/ui/components/sonner"
import { Spinner } from "@banda/ui/components/spinner"
import { useAct } from "@banda/ui/hooks/use-act"
import { useNow } from "@banda/ui/hooks/use-now"
import { useRead } from "@banda/ui/hooks/use-read"
import type { SectionProps } from "@banda/ui/settings"
import { hearAsking, named, type Reached } from "./asking"
import { ChoiceCard } from "./ChoiceCard"
import { pairedWords, remove } from "./paired"
import { KIND_ICONS, useReached } from "./reached"

export function DevicesSettings({ engine }: SectionProps) {
  const [here, ...hosts] = useReached(engine)
  // The machine shown, and the others the window reaches.
  const at = hosts.find((one) => one.engine === engine) ?? here!
  const others = [here!, ...hosts].filter((one) => one !== at)
  // Read again as a device is removed here, and as one that asked is
  // answered, which is when one joins.
  const [round, setRound] = useState(0)
  useEffect(
    () => hearAsking(engine, () => setRound((round) => round + 1)),
    [engine]
  )
  const read = useCallback(
    () => engine.call("devices.list", {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new round reads again
    [engine, round]
  )
  const listed = useRead(read)
  const [removing, setRemoving] = useState<PairedDevice>()
  const now = useNow(60_000)

  if (listed.state === "loading") return <Spinner />
  if (listed.state === "refused")
    return <p className="text-ui text-destructive">{listed.refusal.message}</p>
  const { devices } = listed.value
  return (
    <div className="flex flex-col gap-3">
      <Group title={`On ${at.name}`}>
        <Rows>
          {devices.length === 0 && (
            <Empty>
              <EmptyTitle>No device has joined {at.name} yet</EmptyTitle>
              <EmptyDescription>
                Open {at.name}'s address in a browser or on the phone. Its
                request shows in this window.
              </EmptyDescription>
            </Empty>
          )}
          {devices.map((device) => {
            const Icon = KIND_ICONS[device.kind]
            return (
              <div
                key={device.id}
                data-device={device.id}
                className="flex items-center gap-3 px-3 py-2.5"
              >
                <Icon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-ui font-medium">
                      {device.name}
                    </span>
                  </span>
                  <span className="truncate text-meta text-muted-foreground">
                    {pairedWords(device, now)}
                  </span>
                </div>
                {/* A machine's own window pairs itself again, so
                    removing it does nothing (ADR 0124, decision 6). */}
                {!device.here && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${device.name}…`}
                    onClick={() => setRemoving(device)}
                  >
                    Remove…
                  </Button>
                )}
              </div>
            )
          })}
        </Rows>
      </Group>
      <p className="px-1 text-meta text-muted-foreground">
        Each device reaches {at.name} as you, by a key of its own. Remove one
        and it is cut from {at.name} at once.
      </p>
      {removing && (
        <RemoveDevice
          key={removing.id}
          device={removing}
          at={at}
          others={others}
          onClose={(removed) => {
            setRemoving(undefined)
            if (removed) setRound((round) => round + 1)
          }}
        />
      )}
    </div>
  )
}

function RemoveDevice({
  device,
  at,
  others,
  onClose,
}: {
  device: PairedDevice
  at: Reached
  others: readonly Reached[]
  onClose: (removed: boolean) => void
}) {
  const [where, setWhere] = useState<"every" | "one">("every")
  const { busy, problem, act } = useAct()
  const go = () =>
    act(async () => {
      const also = where === "every" ? others : []
      const { missed } = await remove(at.engine, device, also)
      if (missed.length > 0)
        toast(`${device.name} still reaches ${named(missed)}`, {
          description: "Remove it there once this window reaches it.",
        })
      onClose(true)
    }, "Remove")
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose(false)}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove {device.name}?</DialogTitle>
          <DialogDescription>
            It is cut at once. To come back it asks again, with a new code.
          </DialogDescription>
        </DialogHeader>
        {others.length > 0 && (
          <RadioGroup
            aria-label="Where it is removed"
            value={where}
            onValueChange={(value) => setWhere(value as "every" | "one")}
          >
            <ChoiceCard
              value="every"
              title="From every machine"
              about={`${named([at, ...others].map(({ name }) => name))}.`}
            />
            <ChoiceCard
              value="one"
              title={`Only from ${at.name}`}
              about={`It keeps reaching ${named(others.map(({ name }) => name))}.`}
            />
          </RadioGroup>
        )}
        {problem && (
          <p role="alert" className="text-meta text-destructive">
            {problem}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onClose(false)}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => void go()}
          >
            Remove {device.name}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
