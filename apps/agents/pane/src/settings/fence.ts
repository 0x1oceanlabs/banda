/**
 * The fence in a Thread's words (ADR 0083): what Full access means where
 * it holds and where it does not, and the one reason a new Thread starts
 * Supervised, which the mode menu, the Thread's line and the notice say.
 * The settings' Fence row says the rest. Plain data, so plain tests cover
 * it.
 */
import type { Fence } from "@banda/contract"
import { hasGaps, holdsWhole } from "@banda/ui/hooks/use-status"
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
  if (fence.fence === "holds")
    return !hasGaps(fence)
      ? "You're in the docker group: through Docker, an Agent could step past the fence."
      : fence.docker_group
        ? "The fence has gaps, and you're in the docker group: through Docker, an Agent could step past it."
        : "The fence has gaps: this Linux lacks a part it needs."
  switch (fence.why) {
    case "not_built":
      return "No fence yet: Banda's engine needs a restart."
    case "off":
      return "No fence: turned off for testing (BANDA_FENCE=off)."
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
  if (!hasGaps(fence)) return "You're in the docker group."
  return fence.docker_group
    ? "The fence has gaps; you're in the docker group."
    : "The fence has gaps."
}

/** Whether the reason is a warning of the Person's own setup, the docker
 * group, rather than something missing. */
export function warns(fence: Fence | undefined): boolean {
  return fence?.fence === "holds" && fence.docker_group === true
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
