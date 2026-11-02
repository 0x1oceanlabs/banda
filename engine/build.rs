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
}
