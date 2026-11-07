//! The kernel and the modules stay apart (ADR 0001, decision 3).

use std::path::{Path, PathBuf};

fn sources(dir: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries {
        let path = entry.unwrap().path();
        if path.is_dir() {
            sources(&path, found);
        } else if path.extension().is_some_and(|e| e == "rs") {
            found.push(path);
        }
    }
}

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// Each module's folder, with its `module.toml`: an App's under `apps/`,
/// the platform's under `platform/` (ADR 0062, decision 11).
fn modules() -> Vec<PathBuf> {
    ["apps", "platform"]
        .iter()
        .filter_map(|bucket| std::fs::read_dir(repository().join(bucket)).ok())
        .flatten()
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|path| path.join("module.toml").exists())
        .collect()
}

/// Every module's folder is a name the kernel's source must not contain:
/// the kernel reaches modules only through the Module trait.
#[test]
fn the_kernel_names_no_module() {
    let mut files = Vec::new();
    sources(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    for file in files {
        let code = std::fs::read_to_string(&file).unwrap();
        for folder in modules() {
            let module = folder.file_name().unwrap().to_string_lossy();
            for needle in [
                format!("\"{module}\""),
                format!("\"{module}."),
                format!("{module}_"),
            ] {
                assert!(
                    !code.contains(&needle),
                    "{} names the module {module}",
                    file.display()
                );
            }
        }
    }
}

/// A module writes its own tables only: the event log, the receipts and the
/// outbox are the kernel's, reached through `Tx::emit` and `Tx::enqueue`.
#[test]
fn no_module_touches_the_kernels_tables() {
    for folder in modules() {
        let mut files = Vec::new();
        sources(&folder, &mut files);
        for file in files {
            let code = std::fs::read_to_string(&file).unwrap();
            assert!(
                !code.contains("kernel_"),
                "{} reaches into the kernel's tables",
                file.display()
            );
        }
    }
}
