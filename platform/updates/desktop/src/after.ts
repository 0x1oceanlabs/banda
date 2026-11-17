/**
 * What starts Banda again once this Banda is gone, after an update: the
 * new AppImage on Linux, or the old one where that does not start, and
 * `open` of the new app on macOS.
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
  onceGone(START_AFTER, command, env)
}

/** Runs `script` with this Banda's pid and `args`, apart from Banda, so
 * it outlives it. */
function onceGone(
  script: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv
): void {
  spawn("/bin/bash", ["-c", script, String(process.pid), ...args], {
    detached: true,
    stdio: "ignore",
    env,
  }).unref()
}

/** Once Banda is gone: the shell first closes what it got open from
 * Banda, then waits for process `$0` to end. `/dev/fd` lists the shell's
 * own descriptors on Linux and macOS alike. */
const ONCE_GONE = [
  'for fd in /dev/fd/*; do n=${fd##*/}; ((n > 2)) && eval "exec $n>&-"; done 2>/dev/null',
  'while kill -0 "$0" 2>/dev/null; do sleep 0.2; done',
]

/** `bash -c START_AFTER PID COMMAND…`: what `startAfter` runs. */
const START_AFTER = [...ONCE_GONE, 'exec "$@"'].join("; ")

/** How many fifths of a second the new AppImage has to end badly in for
 * the old one to start in its place: fifteen seconds. */
const STARTS_IN = 75

/** What the old AppImage is told with, as it starts in the new one's
 * place: the file that did not start. */
export const FELL_BACK = "BANDA_UPDATE_FELL_BACK"

/**
 * `bash -c <it> PID NEW OLD ARGS…`: starts NEW once process PID is gone,
 * and OLD if NEW ends badly within `startsIn` fifths of a second, as one
 * that cannot start does. One the Person closed ended well. OLD hears
 * which file it stands in for (`FELL_BACK`).
 */
export const startOrScript = (startsIn = STARTS_IN): string =>
  [
    ...ONCE_GONE,
    "new=$1; old=$2; shift 2",
    '"$new" "$@" & child=$!',
    `n=0; while kill -0 $child 2>/dev/null && ((n < ${startsIn})); do sleep 0.2; n=$((n + 1)); done`,
    "kill -0 $child 2>/dev/null && exit 0",
    "wait $child && exit 0",
    `${FELL_BACK}="$new" exec "$old" "$@"`,
  ].join("; ")

/**
 * Starts the AppImage at `image`, with this Banda's arguments, once this
 * Banda is gone, so the new one gets the window and its lock; and the one
 * at `old` if that does not start. Not `app.relaunch`: its helper runs
 * from this AppImage, unmounted as Banda exits. An AppImage keeps the
 * APPIMAGE and APPDIR it is given, so the new one gets none, and sets its
 * own.
 */
export function startAfterOr(image: string, old: string): void {
  const env = { ...process.env }
  for (const name of ["APPIMAGE", "APPDIR", "ARGV0", "OWD"]) delete env[name]
  onceGone(startOrScript(), [image, old, ...process.argv.slice(1)], env)
}
