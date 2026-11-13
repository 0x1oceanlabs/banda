// `banda-update` says the version it was built as, as `banda` does
// (engine/build.rs): `BANDA_VERSION`, or the workspace's.
fn main() {
    println!("cargo::rerun-if-env-changed=BANDA_VERSION");
    let version = std::env::var("BANDA_VERSION")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| std::env::var("CARGO_PKG_VERSION").unwrap());
    println!("cargo::rustc-env=BANDA_VERSION={version}");
}
