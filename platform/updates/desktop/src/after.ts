/**
 * What starts Banda again once this Banda is gone, after an update: the
 * new AppImage on Linux, `open` of the new app on macOS.
 */
import { spawn } from "node:child_process"

/**
 * Runs `command` with `env` once this process is gone, so what it starts
 * gets the window and its lock. The shell first closes what it got open
 * from Banda (its profile's locks; on Linux this AppImage's folder).
 */
export function startAfter(
  command: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): void {
  spawn("/bin/bash", ["-c", START_AFTER, String(process.pid), ...command], {
    detached: true,
    stdio: "ignore",
    env,
  }).unref()
}

/** `bash -c START_AFTER PID COMMAND…`: what `startAfter` runs. `/dev/fd`
 * lists the shell's own descriptors on Linux and macOS alike. */
const START_AFTER = [
  'for fd in /dev/fd/*; do n=${fd##*/}; ((n > 2)) && eval "exec $n>&-"; done 2>/dev/null',
  'while kill -0 "$0" 2>/dev/null; do sleep 0.2; done',
  'exec "$@"',
].join("; ")
