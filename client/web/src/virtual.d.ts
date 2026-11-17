/** The engine's model of the workspaces, a WebAssembly file as base64
 * (`tilingModel` in `vite.config.ts`). */
declare module "virtual:banda/tiling-model" {
  const bytes: string
  export default bytes
}
