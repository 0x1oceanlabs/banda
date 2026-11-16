//! The model is a leaf: built for a client it brings no store, no
//! runtime, no file's reader and no source of randomness, so it runs as
//! WebAssembly with nothing imported (ADR 0088, decision 11).

use std::process::Command;

/// What a client's build of the model must not bring, each with what it
/// would bring it for.
const NOT_IN_A_CLIENT: [(&str, &str); 7] = [
    ("banda-kernel", "the kernel: its store and its runtime"),
    ("banda-look", "the look, which reads files"),
    ("rusqlite", "SQLite, which is C"),
    ("tokio", "a runtime"),
    ("toml", "a file's reader"),
    (
        "getrandom",
        "a source of randomness, which a browser gives through imports",
    ),
    ("wasm-bindgen", "imports the client would have to give"),
];

/// Cargo, in the model's folder.
fn cargo() -> Command {
    let mut cargo = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()));
    cargo.current_dir(env!("CARGO_MANIFEST_DIR"));
    cargo
}

#[test]
fn a_clients_build_of_the_model_brings_only_what_runs_anywhere() {
    let tree = cargo()
        .args(["tree", "--offline", "--edges", "normal", "--prefix", "none"])
        .args(["--target", "wasm32-unknown-unknown"])
        .output()
        .expect("cargo tree runs");
    assert!(
        tree.status.success(),
        "cargo tree failed: {}",
        String::from_utf8_lossy(&tree.stderr)
    );
    let tree = String::from_utf8_lossy(&tree.stdout);
    let names: Vec<&str> = tree
        .lines()
        .filter_map(|line| line.split(' ').next())
        .collect();
    assert!(
        names.contains(&"banda-base"),
        "the tree was not read:\n{tree}"
    );
    for (name, why) in NOT_IN_A_CLIENT {
        assert!(
            !names.contains(&name),
            "the model depends on {name} ({why}): it runs in a client too, so it takes \
             what it needs as a parameter, or the word moves to banda-base"
        );
    }
}

/// The tree says what the model depends on, not that it builds with it:
/// beside the engine's crates, and in its own tests, `banda-base` has its
/// feature `engine` on, so an ID made by the clock compiles there. Alone,
/// as a client builds it, it must not.
#[test]
fn the_model_builds_as_a_client_builds_it() {
    let check = cargo()
        .args(["check", "--offline", "--lib", "--quiet"])
        .output()
        .expect("cargo check runs");
    assert!(
        check.status.success(),
        "the model does not build without the engine's side of banda-base:\n{}",
        String::from_utf8_lossy(&check.stderr)
    );
}
