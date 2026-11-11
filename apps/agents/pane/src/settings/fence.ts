/**
 * The fence in a Thread's words (ADR 0083): what Full access means where
 * it holds and where it does not, and the one reason a new Thread starts
 * Supervised, which the mode menu, the Thread's line and the notice say.
 * The settings' Fence row says the rest. Plain data, so plain tests cover
 * it.
 */
import type { Fence } from "@banda/contract"
import { hasGaps, hasLinks, holdsWhole } from "@banda/ui/hooks/use-status"
import { isMac } from "@banda/ui/lib/keys"
import type { Args } from "@banda/ui/module"

/** Where "Learn more" leads: Settings → General, the Fence row lit. */
export const FENCE_LINK = "general/fence"

/** What Full access means, as the mode menu says under its name. */
export function fullAccessAbout(fence: Fence | undefined): string {
  return holdsWhole(fence)
    ? "Never asks, and works with your rights, not Banda's."
    : "Never asks. This Agent is you, in Banda too."
}

/** Why a new Thread starts Supervised here, in one sentence; none where
 * the fence holds whole, or before the engine said. */
export function reasonOf(fence: Fence | undefined): string | undefined {
  if (!fence || holdsWhole(fence)) return undefined
  if (fence.fence === "holds") {
    if (hasGaps(fence))
      return fence.docker_group
        ? "The fence has gaps, and you're in the docker group: through Docker, an Agent could step past it."
        : "The fence has gaps: this Linux lacks a part it needs."
    if (fence.docker_group)
      return "You're in the docker group: through Docker, an Agent could step past the fence."
    return "Some settings the fence keeps from Agents are links, which an Agent could point elsewhere."
  }
  switch (fence.why) {
    case "not_built":
      return "No fence yet: Banda's engine needs a restart."
    case "off":
      return "No fence: off until it is designed whole (BANDA_FENCE=on turns it on)."
    case "unsupported_os":
      return isMac
        ? "No fence: Banda has none for macOS yet."
        : "No fence: Banda has none for Windows."
    case "setup_failed":
      return "No fence: Banda could not set it up here."
    case "apparmor":
    case "no_user_namespaces":
    case "refused":
      return "No fence: this computer blocks it."
  }
}

/** The reason as a Thread's one-row line has room for: the docker group
 * and the gaps say only what, and Learn more says why. */
export function shortReasonOf(fence: Fence | undefined): string | undefined {
  if (fence?.fence !== "holds" || holdsWhole(fence)) return reasonOf(fence)
  if (hasGaps(fence))
    return fence.docker_group
      ? "The fence has gaps; you're in the docker group."
      : "The fence has gaps."
  if (fence.docker_group) return "You're in the docker group."
  return "Some settings are links."
}

/** Whether the reason is a warning of the Person's own setup, the docker
 * group or settings kept as links, rather than something missing. */
export function warns(fence: Fence | undefined): boolean {
  if (fence?.fence !== "holds") return false
  return fence.docker_group === true || (!hasGaps(fence) && hasLinks(fence))
}

/**
 * The notice that Threads from before the fence now start Supervised, as
 * the notifications module tells it (ADR 0056, decision 2): its bell
 * shows it again, and Learn more leads to the Fence row. Silent, with the
 * plain edge of news that asks nothing.
 */
export function noticeOf(fence: Fence): Args {
  const reason = reasonOf(fence)
  return {
    key: "fence.supervised",
    kind: "done",
    title: "Threads now start Supervised",
    ...(reason && { body: reason }),
    buttons: [
      {
        label: "Learn more",
        action: "settings.open",
        args: { link: FENCE_LINK },
      },
    ],
    silent: true,
  }
}
