//! `banda settings` as an Agent or the window runs it (ADR 0016).

mod common;

use common::banda;

#[test]
fn settings_check_names_each_file_and_line() {
    let config = tempfile::tempdir().unwrap();
    std::fs::write(config.path().join("look.toml"), "radius = 6\n").unwrap();
    let harnesses = config.path().join("harnesses.toml");
    std::fs::write(&harnesses, "[[harness]]\nid = \"x\"\nname = 3\n").unwrap();
    let out = banda(config.path(), &["settings", "check"]);
    assert_eq!(out.status.code(), Some(1));
    let said = String::from_utf8(out.stderr).unwrap();
    assert!(
        said.starts_with(&format!("{}:3:8: ", harnesses.display())),
        "{said}"
    );

    std::fs::write(
        &harnesses,
        "[[harness]]\nid = \"x\"\nname = \"X\"\ncommand = \"x\"\n",
    )
    .unwrap();
    let out = banda(config.path(), &["settings", "check"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(out.stderr.is_empty());
}

#[test]
fn settings_schema_prints_a_file_and_exports_them_all() {
    let config = tempfile::tempdir().unwrap();
    let out = banda(config.path(), &["settings", "schema", "look.toml"]);
    assert!(out.status.success());
    let schema: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(schema["title"], "look.toml");

    let out = banda(config.path(), &["settings", "schema", "--export"]);
    assert!(out.status.success());
    for name in ["look", "sidebar", "harnesses"] {
        let path = config.path().join(format!("schemas/{name}.schema.json"));
        assert!(path.exists(), "{}", path.display());
    }

    let out = banda(config.path(), &["settings", "schema", "nope"]);
    assert_eq!(out.status.code(), Some(2));
}

#[test]
fn settings_set_and_reset_change_one_key() {
    let config = tempfile::tempdir().unwrap();
    let look = config.path().join("look.toml");
    std::fs::write(&look, "# mine\nradius = 4\n").unwrap();

    let out = banda(
        config.path(),
        &["settings", "set", "look.toml", "tile.border", "3"],
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        std::fs::read_to_string(&look).unwrap(),
        "# mine\nradius = 4\n\n[tile]\nborder = 3\n"
    );

    let out = banda(
        config.path(),
        &["settings", "set", "look.toml", "radius", "big"],
    );
    assert_eq!(out.status.code(), Some(1));
    let said = String::from_utf8(out.stderr).unwrap();
    assert!(
        said.starts_with(&format!("{}:2:", look.display())),
        "{said}"
    );

    let keys = config.path().join("keys.toml");
    std::fs::write(&keys, "[binds]\n\"Alt+J\" = \"pane.close\" # mine\n").unwrap();
    let out = banda(
        config.path(),
        &[
            "settings",
            "rename",
            "keys.toml",
            "binds.\"Alt+J\"",
            "Alt+Q",
        ],
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        std::fs::read_to_string(&keys).unwrap(),
        "[binds]\n\"Alt+Q\" = \"pane.close\" # mine\n"
    );

    let out = banda(config.path(), &["settings", "reset", "look.toml", "radius"]);
    assert!(out.status.success());
    assert_eq!(
        std::fs::read_to_string(&look).unwrap(),
        "# mine\n\n[tile]\nborder = 3\n"
    );
}
