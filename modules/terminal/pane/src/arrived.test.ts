import type { SpaceId } from "@banda/contract"
import type { Server } from "@banda/contract/terminal"
import { describe, expect, it } from "vitest"
import { arrived } from "./arrived"

const here = "here" as SpaceId
const there = "there" as SpaceId
const server = (port: number, program = "vite"): Server => ({
  port,
  process: port * 10,
  program,
  by: "agent",
})
const ports = (list: { server: Server }[]) => list.map((p) => p.server.port)

describe("every Project's servers", () => {
  it("stand in the order they came, whichever Project they are in", () => {
    let list = arrived([], here, [server(5173)])
    list = arrived(list, there, [server(3000)])
    list = arrived(list, here, [server(6006), server(5173)])
    expect(ports(list)).toEqual([5173, 3000, 6006])
    expect(list.map((p) => p.space)).toEqual([here, there, here])
  })

  it("lose the ones gone and keep what each Project says of the rest", () => {
    let list = arrived([], here, [server(5173), server(6006)])
    list = arrived(list, there, [server(3000)])
    list = arrived(list, here, [server(6006, "storybook dev")])
    expect(ports(list)).toEqual([6006, 3000])
    expect(list[0].server.program).toBe("storybook dev")
    expect(arrived(list, there, [])).toEqual([list[0]])
  })
})
