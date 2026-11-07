//! The requests the engine makes itself, from its host, as no client does
//! the host's work (ADR 0062, decision 3): Claude Code's limits (ADR 0043)
//! and what sharing sends (ADR 0039). They share one client:
//!
//! - TLS by rustls, with the system's certificates.
//! - The proxy `HTTPS_PROXY`, `HTTP_PROXY` or `ALL_PROXY` names, with
//!   `NO_PROXY`'s exceptions, and on macOS the HTTP and HTTPS proxies the
//!   system's settings name. A PAC file, or a Linux desktop's own proxy
//!   settings, it does not read.
//! - It follows no redirect, so what a request carries goes to its own
//!   address alone, and keeps no cookie.

use std::sync::OnceLock;

/// The engine's one client, made at its first request; why it could not
/// be made, when it could not.
pub fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let made = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(format!("banda/{}", crate::version()))
        .build()
        .map_err(|e| format!("Banda's HTTPS did not start: {}", cause(&e)))?;
    Ok(CLIENT.get_or_init(|| made))
}

/// What went wrong at the bottom of `error`: "connection refused", not
/// only "error sending request".
pub fn cause(error: &(dyn std::error::Error + 'static)) -> String {
    let mut at = error;
    while let Some(under) = at.source() {
        at = under;
    }
    at.to_string()
}
