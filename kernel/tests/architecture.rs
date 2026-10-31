//! The kernel names no module (ADR 0001, decision 3): every folder under
//! `modules/` is a name the kernel's source must not contain.

use std::path::{Path, PathBuf};

fn sources(dir: &Path, found: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            sources(&path, found);
        } else if path.extension().is_some_and(|e| e == "rs") {
            found.push(path);
        }
    }
}

#[test]
fn the_kernel_names_no_module() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let modules: Vec<String> = std::fs::read_dir(root.join("modules"))
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    let mut files = Vec::new();
    sources(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src"), &mut files);
    for file in files {
        let code = std::fs::read_to_string(&file).unwrap();
        for module in &modules {
            for needle in [format!("\"{module}\""), format!("\"{module}."), format!("{module}_")] {
                assert!(
                    !code.contains(&needle),
                    "{} names the module {module}; the kernel must reach modules only through the Module trait",
                    file.display()
                );
            }
        }
    }
}
