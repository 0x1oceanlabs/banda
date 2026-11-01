/** A TOML file the build bundles as its text (build.mjs). */
declare module "*.toml" {
  const text: string
  export default text
}
