//! ACP is the first Harness adapter, not the module's language: its words
//! stop in `acp.rs` (docs/architecture.md, "Harnesses").

use std::path::Path;

#[test]
fn only_the_acp_adapter_names_the_protocol() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    for entry in std::fs::read_dir(&src).unwrap() {
        let path = entry.unwrap().path();
        if path.file_name().is_some_and(|name| name == "acp.rs") {
            continue;
        }
        let code = std::fs::read_to_string(&path).unwrap();
        assert!(
            !code.contains("agent_client_protocol"),
            "{} names the ACP crate; only acp.rs speaks ACP",
            path.display()
        );
    }
}
