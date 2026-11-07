/**
 * Whether a path names a file on this machine's own disks, so that a look
 * at it stays on this machine (ADR 0090, decision 7). It is whole: on
 * Windows on a drive, never a share or a device (`\\host\…`, `\\?\…`,
 * `\\.\…`, `\??\…`), as a look at a share sends the Person's NTLM hash to
 * its host; nor a file's stream (`x.bat::$DATA`), which opens as another
 * kind of file. Elsewhere it starts at the root, and never at `//`.
 */
export const onThisMachineOn =
  (platform: NodeJS.Platform) =>
  (path: string): boolean => {
    if (path.includes("\0")) return false
    if (platform === "win32")
      return /^[a-z]:[\\/]/i.test(path) && !path.includes(":", 2)
    return path.startsWith("/") && !path.startsWith("//")
  }

/** Whether `path` is on this machine: see `onThisMachineOn`. */
export const onThisMachine = onThisMachineOn(process.platform)
