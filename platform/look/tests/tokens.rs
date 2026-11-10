//! The token list's files (ADR 0080, decision 7; ADR 0100, step 2): the
//! CSS the page reads before the first look comes, and a TypeScript object
//! for other clients, written from the list in `banda_theme::tokens` and
//! from Banda's own theme as `banda look` gives it with no files. They go
//! where ts-rs writes the contract's types, `sdk/contract/src/generated/`,
//! so `scripts/check.sh` fails when a change to the list or the theme left
//! them stale, as it does for the types.

use banda_look::{Look, Places, resolve};
use banda_theme::tokens::{Group, Kind, SAID_ONLY, TOKENS, Token, token};
use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::PathBuf;

/// Banda's own theme, as `banda look` gives it on a machine with no files
/// and no Omarchy: Banda's both schemes, solid.
fn banda() -> Look {
    let dir = tempfile::tempdir().unwrap();
    let look = resolve(
        &Places::at(&dir.path().join("banda")),
        &|| None,
        &[],
        &Default::default(),
    )
    .look;
    assert!(look.problems.is_empty(), "{:?}", look.problems);
    look
}

/// Each scheme's tokens, light then dark, with the sizes, by their names
/// without `--`.
fn schemes(look: &Look) -> [BTreeMap<&str, &str>; 2] {
    [&look.schemes.light, &look.schemes.dark].map(|colors| {
        let colors = colors.as_ref().expect("Banda's own has both schemes");
        (look.vars.iter().chain(colors))
            .map(|(name, value)| (&name[2..], value.as_str()))
            .collect()
    })
}

#[test]
fn the_look_gives_every_token_and_only_those() {
    let look = banda();
    for (name, value) in &look.vars {
        let listed = token(&name[2..]).unwrap_or_else(|| panic!("{name} is in no list"));
        assert_ne!(
            listed.kind,
            Kind::Colour,
            "{name} is a colour, among the sizes"
        );
        assert!(
            !value.contains("var(") && !value.contains("calc("),
            "{name}: {value}"
        );
    }
    for (n, scheme) in schemes(&look).iter().enumerate() {
        for listed in TOKENS {
            let value = scheme.get(listed.name);
            assert!(
                value.is_some_and(|v| !v.is_empty()),
                "no {} in scheme {n}",
                listed.name
            );
        }
        for (name, value) in scheme {
            assert!(token(name).is_some(), "{name} is in no list");
            assert!(
                !value.contains("var(") && !value.contains("color-mix("),
                "{name}: {value}"
            );
        }
    }
}

/// Where the generated files go: ts-rs's folder, as `.cargo/config.toml`
/// sets it for every test.
fn generated() -> PathBuf {
    std::env::var_os("TS_RS_EXPORT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../sdk/contract/src/generated")
        })
        .join("look")
}

/// What the page sets before the first look comes: every token but the
/// radii, which `globals.css` still works out (ADR 0100, step 3), and
/// those only a theme that says them has, whose stand-in the page works
/// out (step 4).
fn in_css(listed: &Token) -> bool {
    listed.group != Group::Radius && !SAID_ONLY.contains(&listed.name)
}

const WRITTEN: &str = "Written by platform/look/tests/tokens.rs from the list in\n \
                       * platform/theme/src/tokens.rs and Banda's own theme: change them there.";

fn css(light: &BTreeMap<&str, &str>, dark: &BTreeMap<&str, &str>) -> String {
    let mut css = format!(
        "/*\n * Banda's tokens as `banda look` gives them with no files: what the\n \
         * page shows before the first look comes (ADR 0080, decision 7).\n * {WRITTEN}\n */\n:root {{\n"
    );
    for listed in TOKENS.iter().filter(|listed| in_css(listed)) {
        writeln!(css, "  --{}: {};", listed.name, light[listed.name]).unwrap();
    }
    css.push_str("}\n\n.dark {\n");
    let colours = TOKENS.iter().filter(|listed| listed.kind == Kind::Colour);
    for listed in colours.filter(|listed| in_css(listed)) {
        writeln!(css, "  --{}: {};", listed.name, dark[listed.name]).unwrap();
    }
    css.push_str("}\n");
    css
}

fn typescript(light: &BTreeMap<&str, &str>, dark: &BTreeMap<&str, &str>) -> String {
    let quoted = |text: &str| serde_json::to_string(text).unwrap();
    let union = |words: Vec<&str>| {
        let mut seen = Vec::new();
        for word in words {
            if !seen.contains(&word) {
                seen.push(word);
            }
        }
        seen.iter()
            .map(|w| quoted(w))
            .collect::<Vec<_>>()
            .join(" | ")
    };
    let mut ts = format!(
        "/**\n * Banda's tokens (ADR 0080, decision 7): each by its name, what its\n \
         * value is and its group, and Banda's own theme as `banda look` gives\n \
         * it with no files, light and dark, for a client to draw before its\n \
         * first look comes.\n * {WRITTEN}\n */\n"
    );
    let kinds = union(TOKENS.iter().map(|t| t.kind.word()).collect());
    let groups = union(TOKENS.iter().map(|t| t.group.word()).collect());
    writeln!(
        ts,
        "export type TokenKind = {kinds}\n\nexport type TokenGroup = {groups}\n"
    )
    .unwrap();
    ts.push_str("export const TOKENS = {\n");
    for listed in TOKENS {
        let (kind, group) = (listed.kind.word(), listed.group.word());
        let line = format!("{{ kind: {}, group: {} }}", quoted(kind), quoted(group));
        writeln!(ts, "  {}: {line},", quoted(listed.name)).unwrap();
    }
    ts.push_str(
        "} as const satisfies Readonly<\n  Record<string, { kind: TokenKind; group: TokenGroup }>\n>\n\n\
         export type Token = keyof typeof TOKENS\n\n\
         export const BANDA: Readonly<\n  Record<\"light\" | \"dark\", Readonly<Record<Token, string>>>\n> = {\n",
    );
    for (mode, scheme) in [("light", light), ("dark", dark)] {
        writeln!(ts, "  {mode}: {{").unwrap();
        for listed in TOKENS {
            writeln!(
                ts,
                "    {}: {},",
                quoted(listed.name),
                quoted(scheme[listed.name])
            )
            .unwrap();
        }
        ts.push_str("  },\n");
    }
    ts.push_str("}\n");
    ts
}

#[test]
fn the_css_and_the_typescript_are_written_from_the_list() {
    let look = banda();
    let [light, dark] = schemes(&look);
    let folder = generated();
    std::fs::create_dir_all(&folder).unwrap();
    for (name, text) in [
        ("tokens.css", css(&light, &dark)),
        ("tokens.ts", typescript(&light, &dark)),
    ] {
        let path = folder.join(name);
        if std::fs::read_to_string(&path).ok().as_deref() != Some(text.as_str()) {
            std::fs::write(&path, text).unwrap();
        }
    }
}
