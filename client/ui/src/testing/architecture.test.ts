import { expect, test } from "vitest"
import { imports } from "./architecture"

test("the check sees every kind of import", () => {
  expect(
    imports(
      `import a from "x"\nimport "y"\nconst z = import("z")\nexport { b } from 'w'`
    )
  ).toEqual(["x", "y", "z", "w"])
})
