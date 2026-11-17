import { expect, it } from "vitest"
import { arrivedAt, firstLine, installsAtQuit, needsPerson } from "./app"

it("shows only what the Person has to mend", () => {
  const coded = (code: string) => Object.assign(new Error(code), { code })
  expect(needsPerson(coded("EACCES"))).toBe(true)
  expect(needsPerson(coded("ENOSPC"))).toBe(true)
  expect(needsPerson(coded("ENOTFOUND"))).toBe(false)
  expect(needsPerson(new Error("ERR_UPDATER_CHANNEL_FILE_NOT_FOUND"))).toBe(
    false
  )
})

it("keeps an error's first line, without its headers", () => {
  expect(firstLine("HttpError: 404 \nHeaders: {…}")).toBe("HttpError: 404")
})

it("says Banda updated only when it restarted into the version left (ADR 0072)", () => {
  const left = JSON.stringify({ from: "0.1.0-dev.97", to: "0.1.0-dev.104" })
  expect(arrivedAt(left, "0.1.0-dev.104")).toEqual({ from: "0.1.0-dev.97" })
  // The install did not take, or an older file stayed behind.
  expect(arrivedAt(left, "0.1.0-dev.97")).toBeUndefined()
  expect(arrivedAt("{", "0.1.0-dev.104")).toBeUndefined()
})

it("installs at the quit only what the last look, an hour old at most, still offered (ADR 0092)", () => {
  const at = Date.parse("2026-11-08T12:00:00Z")
  const quit = {
    ready: "0.1.0-dev.421",
    offered: { version: "0.1.0-dev.421", at: at - 50 * 60_000 },
    listed: "0.1.0-dev.420",
    at,
  }
  expect(installsAtQuit(quit)).toBe(true)
  // An entry naming no version, as a file the Person renamed, holds none back.
  expect(installsAtQuit({ ...quit, listed: undefined })).toBe(true)
  // Nothing ready, or the last look offered another.
  expect(installsAtQuit({ ...quit, ready: undefined })).toBe(false)
  expect(installsAtQuit({ ...quit, offered: undefined })).toBe(false)
  expect(
    installsAtQuit({
      ...quit,
      offered: { ...quit.offered, version: "0.1.0-dev.420" },
    })
  ).toBe(false)
  // A look over an hour old: the version may have been withdrawn since.
  expect(
    installsAtQuit({
      ...quit,
      offered: { ...quit.offered, at: at - 2 * 3_600_000 },
    })
  ).toBe(false)
  // A newer Banda Dev started from another file since: its entry stays.
  expect(installsAtQuit({ ...quit, listed: "0.1.0-dev.421" })).toBe(false)
  expect(installsAtQuit({ ...quit, listed: "0.750.0" })).toBe(false)
})
