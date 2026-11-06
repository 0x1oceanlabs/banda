// Which Banda is built (ADR 0033, decision 1): `BANDA_CHANNEL` names it, and
// the folder its things go in comes from it (src/places.rs). A checkout is
// `local`; a name that is no channel stops the build.
fn main() {
    println!("cargo::rerun-if-env-changed=BANDA_CHANNEL");
    let channel = std::env::var("BANDA_CHANNEL").unwrap_or_default();
    let folder = match channel.as_str() {
        "stable" => "banda",
        "dev" => "banda-dev",
        "" | "local" => "banda-local",
        other => panic!("BANDA_CHANNEL is stable, dev or local, not {other:?}."),
    };
    println!("cargo::rustc-env=BANDA_FOLDER={folder}");

    // Its version (decision 2): 0.X.Y or 0.X.Y-dev.N, or the workspace's.
    println!("cargo::rerun-if-env-changed=BANDA_VERSION");
    let version = std::env::var("BANDA_VERSION")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| std::env::var("CARGO_PKG_VERSION").unwrap());
    println!("cargo::rustc-env=BANDA_VERSION={version}");

    // Each build is known by its build id (ADR 0086, decision 2). A Mach-O
    // always has its UUID; an ELF has a build id only when the linker is
    // asked for one, as most toolchains ask by default, so `banda` asks.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        println!("cargo::rustc-link-arg-bins=-Wl,--build-id=sha1");
    }
}
