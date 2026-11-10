/**
 * Where this device keeps the directory (ADR 0106, decision 1): which
 * machine has each Project, in the window's storage, which every window
 * on the device shares, so a Pane restored while its machine is away
 * still goes there, and one popped out finds what the main window
 * learned. The Window's hosts learn it (`KeptHosts`); this only keeps it,
 * as `seenNamed` keeps the hosts' names.
 */
import { isPlaced, type Placed } from "@banda/core"
import { kept } from "@banda/ui/lib/kept"

// Past the Projects a device meets: each Thread's own scratch Project is
// one too, and a machine's is learned again only while it lists it.
const KEEP = 5000

export const DIRECTORY = kept<Placed>(
  "banda.machines.directory",
  isPlaced,
  KEEP
)
