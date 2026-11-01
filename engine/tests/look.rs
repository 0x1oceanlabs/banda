//! `bandaso look` as a script or the window runs it: JSON on stdout, and
//! `check` speaking as compilers do.

use std::process::{Command, Output};

fn bandaso(config: &std::path::Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_bandaso"))
        .args(args)
        .env("BANDA_CONFIG", config)
        .env("BANDA_OMARCHY", "")
        .env("BANDA_FONTCONFIG", "")
        .env_remove("HYPRLAND_INSTANCE_SIGNATURE")
        .output()
        .expect("bandaso runs")
}

#[test]
fn look_prints_the_resolved_look_as_json() {
    let config = tempfile::tempdir().unwrap();
    std::fs::write(config.path().join("look.toml"), "radius = 6\n").unwrap();
    let out = bandaso(config.path(), &["look"]);
    assert!(out.status.success());
    let look: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(look["mode"], "system");
    assert_eq!(look["vars"]["--radius"], "6px");
    assert_eq!(look["vars"]["--tile-radius"], "8.4px");
    assert!(look["schemes"]["light"]["--background"].is_string());
    assert!(look["schemes"]["dark"]["--background"].is_string());
}

#[test]
fn look_check_names_the_line_and_exits_one() {
    let config = tempfile::tempdir().unwrap();
    let file = config.path().join("look.toml");
    std::fs::write(&file, "[gaps]\ninner = 4\nouter = \"wide\"\n").unwrap();
    let out = bandaso(config.path(), &["look", "check"]);
    assert_eq!(out.status.code(), Some(1));
    let said = String::from_utf8(out.stderr).unwrap();
    assert!(
        said.starts_with(&format!("{}:3:9: ", file.display())),
        "{said}"
    );

    std::fs::write(&file, "[gaps]\nouter = 8\n").unwrap();
    let out = bandaso(config.path(), &["look", "check", file.to_str().unwrap()]);
    assert!(out.status.success());
    assert!(out.stderr.is_empty() && out.stdout.is_empty());
}

#[test]
fn look_themes_lists_bandas_own_one_per_line() {
    let config = tempfile::tempdir().unwrap();
    let out = bandaso(config.path(), &["look", "themes"]);
    assert!(out.status.success());
    let names: Vec<String> = String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap()["name"].to_string())
        .collect();
    assert!(names.starts_with(&["\"banda-light\"".into(), "\"banda-dark\"".into()]));
}
